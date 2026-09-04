import { createServer } from "node:http";
import { chromium, type Browser } from "playwright";
import { startPollingLoop, requestShutdown, activeJobCount } from "./jobs/jobRunner";

const PORT = Number(process.env.PORT ?? 8080);

let browserInstance: Browser | null = null;
let browserLaunchError: string | null = null;

/**
 * ВАЖНО про порядок запуска:
 * Cloud Run (и аналогичные serverless-платформы) убивают деплой, если
 * контейнер не начал слушать $PORT в течение ограниченного времени.
 * Запуск полноценного браузера Chromium может занимать заметное время (а в
 * худшем случае — зависнуть), поэтому HTTP-сервер поднимается СРАЗУ, а
 * Chromium запускается уже после этого, асинхронно. Так провал запуска
 * браузера не превращается в невозможность задеплоить сервис вообще.
 */
function startHealthServer() {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      const ready = browserInstance !== null;
      res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: ready ? "ok" : "starting",
          activeJobs: activeJobCount(),
          browserError: browserLaunchError,
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(PORT, () => console.log(`[browser-worker] health-check на :${PORT}`));
  return server;
}

async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    // Cloud Run (и большинство контейнерных serverless-платформ) уже
    // изолируют процесс на уровне своей собственной песочницы (например,
    // gVisor) — вложенная песочница самого Chromium в таких средах часто
    // не может корректно инициализироваться (не хватает нужных syscalls),
    // из-за чего браузер зависает при старте и не запускается вовсе.
    // chromiumSandbox: false — стандартная и ожидаемая практика для
    // headless Chromium внутри Docker/Cloud Run; изоляция между сайтами
    // при этом всё равно обеспечивается на уровне ОТДЕЛЬНОГО browser
    // context на каждый анализируемый сайт (см. pageAnalyzer.ts), а не
    // внутренним sandbox'ом Chromium.
    chromiumSandbox: false,
    args: ["--disable-dev-shm-usage"],
  });
}

async function main() {
  const server = startHealthServer();

  const shutdown = async (signal: string) => {
    console.log(`[browser-worker] получен ${signal}, завершаю работу…`);
    requestShutdown();
    const deadline = Date.now() + 15_000;
    while (activeJobCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (browserInstance) await browserInstance.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    browserInstance = await launchBrowser();
  } catch (err) {
    browserLaunchError = err instanceof Error ? err.message : String(err);
    console.error("[browser-worker] не удалось запустить Chromium:", browserLaunchError);
    // Сервер (и его /health) продолжает работать, чтобы контейнер не
    // считался упавшим и логи причины были видны — но polling loop без
    // браузера не имеет смысла запускать.
    return;
  }

  await startPollingLoop(browserInstance);
}

main().catch((err) => {
  console.error("[browser-worker] фатальная ошибка запуска:", err);
  process.exit(1);
});
