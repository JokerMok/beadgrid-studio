import { createRoot } from "react-dom/client";
import App from "./App";
import { resetLegacyProductCache } from "./cache-reset";
import "./styles.css";
import "./workbench.css";
import "./editor-dialogs.css";
import "./bead-list.css";
resetLegacyProductCache()
  .then(() => createRoot(document.getElementById("root")!).render(<App />))
  .catch(() => {
    const target = document.getElementById("root")!;
    target.textContent =
      "旧拼豆缓存备份或清理未完成。请关闭其他拼豆窗口后刷新；旧数据未作为公共账号草稿加载。";
  });

import "./product-flow.css";
