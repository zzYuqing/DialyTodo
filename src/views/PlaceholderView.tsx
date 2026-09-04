// 职责：占位组件 —— Todo 页为主路径，归档与设置尚在后续阶段，暂给统一占位。
// 阶段 4 起逐步把每个视图替换成真实实现。共用占位保证视觉一致、避免重复。

import styles from "./PlaceholderView.module.css";

interface PlaceholderProps {
  /** 视图名，仅供占位内部显示 */
  name: string;
  /** 这个视图计划在哪个阶段交付 */
  phase: string;
  /** 简要说明该视图未来会做什么 */
  description: string;
}

export function PlaceholderView({ name, phase, description }: PlaceholderProps) {
  return (
    <section className={styles.view}>
      <h2 className={styles.title}>{name}</h2>
      <p className={styles.badge}>阶段 {phase} 交付</p>
      <p className={styles.desc}>{description}</p>
    </section>
  );
}