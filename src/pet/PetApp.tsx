// 职责：桌宠窗口入口（阶段 6 占位）。
// 当前仅渲染一个透明占位，用于打通第二个 Vite 入口与独立窗口的构建链路。
// 桌宠本体（半透明、可拖动、悬浮缩放与鼠标穿透）在阶段 6 实现。

import ReactDOM from "react-dom/client";
import styles from "./pet.module.css";

function PetApp() {
  return (
    <div className={styles.root}>
      <span className={styles.pig}>🐷</span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("pet-root") as HTMLElement).render(<PetApp />);
