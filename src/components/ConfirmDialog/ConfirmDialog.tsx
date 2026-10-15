// 职责：通用二次确认弹窗 —— 包裹 Mantine Modal，用于「删除任务 / 删除子任务」等
// 不可逆操作的确认。统一走这个弹窗替代原生 window.confirm，保证浅/深色主题下
// 视觉一致、可聚焦、可键盘操作（Esc / 点遮罩 = 取消）。
// 设计：确认按钮走危险色（--dt-danger），取消走默认态；默认焦点不落在确认上，
// 避免回车误删。message 接受 ReactNode，便于用 <strong> 强调被删除对象的标题。

import { Button, Modal, Stack } from "@mantine/core";
import type { ReactNode } from "react";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  /** false = 不渲染，由父组件用「待删除对象」是否为空控制开合 */
  opened: boolean;
  /** 弹窗标题，如「删除任务」「删除子任务」 */
  title: string;
  /** 说明文案，接受 ReactNode，可嵌入 <strong> 强调被删除对象的标题 */
  message: ReactNode;
  /** 确认按钮文字，默认「删除」 */
  confirmLabel?: string;
  /** 取消按钮文字，默认「取消」 */
  cancelLabel?: string;
  /**
   * 确认按钮色调：danger = 危险色实心（默认，用于删除等不可逆操作）；
   * primary = 主题强调色（墨绿），用于「标记完成」等正向但需二次确认的动作，
   * 避免把正向操作也用删除红，造成语义错位。
   */
  confirmVariant?: "danger" | "primary";
  /** 点击确认时回调，由父组件执行真正的删除 */
  onConfirm: () => void;
  /** 点击取消 / 遮罩 / Esc 时回调，父组件清空待删除状态 */
  onCancel: () => void;
}

export function ConfirmDialog({
  opened,
  title,
  message,
  confirmLabel = "删除",
  cancelLabel = "取消",
  confirmVariant = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={title}
      centered
      size="sm"
      padding="md"
      radius="md"
      closeOnEscape
      overlayProps={{ backgroundOpacity: 0.45, blur: 2 }}
      className={styles.modal}
    >
      <Stack gap="lg">
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <Button variant="default" onClick={onCancel} className={styles.cancel}>
            {cancelLabel}
          </Button>
          <Button
            className={[
              styles.confirm,
              confirmVariant === "primary" ? styles.confirmPrimary : "",
            ]
              .filter((c) => c !== "")
              .join(" ")}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}
