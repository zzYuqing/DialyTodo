// 职责：主窗口前端入口。
// 装配 MantineProvider 并挂载根组件。不在此处做数据初始化，交由 App 的 effect 完成。

import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@/styles/theme.css";
import "@/styles/global.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <MantineProvider defaultColorScheme="light">
    <App />
  </MantineProvider>,
);
