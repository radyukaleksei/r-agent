import { createServer } from "node:http";
import { chromium } from "playwright";
import { startPollingLoop, requestShutdown, activeJobCount } from "./jobs/jobRunner";

const PORT = Number(process.env.PORT ?? 8080);

async function main() {
  // Один browser-процесс на инстанс, переиспользуется между job'ами —
  // отдельные browser CONTEXT создаются на каждый сайт внутри pageAnalyzer
  // (изоляция cookies/storage между сайтами одного job'а).
  const browser = await chromium.launch({
    headless: true,
    args: [
      // НЕ отключаем sandbox: --no-sandbox сознательно не добавлен,
      // см. README → "Sandbox для browser workers".
      "--disable-dev-shm-usage",
    ],
  });

  // Cloud Run требует, чтобы контейнер слушал $PORT — используем это же
  // как простой health-check endpoint.
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", activeJobs: activeJobCount() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(PORT, () => console.log(`[browser-worker] health-check на :${PORT}`));

  const shutdown = async (signal: string) => {
    console.log(`[browser-worker] получен ${signal}, завершаю работу…`);
    requestShutdown();
    // Даём текущим job'ам немного времени на завершение перед закрытием браузера.
    const deadline = Date.now() + 15_000;
    while (activeJobCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await browser.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await startPollingLoop(browser);
}

main().catch((err) => {
  console.error("[browser-worker] фатальная ошибка запуска:", err);
  process.exit(1);
});
