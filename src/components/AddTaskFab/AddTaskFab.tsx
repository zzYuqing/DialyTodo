// 职责：右下角悬浮新建按钮（FAB）——点击后打开新建任务弹窗。
// 设计要点：
// - 只负责"发起点新建"这一个动作，表单本身由 EditTaskModal 承担；
// - 定位由父容器提供（父容器需 position: relative），这里不写 fixed，避免跨视图定位错乱。

import { PlusIcon } from "@/components/Icons";
import styles from "./AddTaskFab.module.css";

interface AddTaskFabProps {
  onClick: () => void;
}

export function AddTaskFab({ onClick }: AddTaskFabProps) {
  return (
    <button
      type="button"
      className={styles.fab}
      onClick={onClick}
      title="新建任务"
      aria-label="新建任务"
    >
      <PlusIcon size={22} />
    </button>
  );
}
