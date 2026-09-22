// 职责：任务集展开区的展示常量集中定义，禁止在业务代码里散落魔法数字。

/**
 * 已勾选子任务默认保留（不折叠）的条数：超出这个数量的较早完成项会被收进折叠节点。
 * 这是设置项 subtaskDoneKeep 的出厂默认值。
 */
export const DEFAULT_SUBTASK_DONE_KEEP = 5;

/**
 * 允许配置的区间。
 * 下限 1：0 条等价于「已完成全部折叠」，展开区里就只剩一条折叠节点，没有意义；
 * 上限 99：防止把展开区撑成超长列表，失去折叠本来的用途。
 */
export const SUBTASK_DONE_KEEP_MIN = 1;
export const SUBTASK_DONE_KEEP_MAX = 99;
