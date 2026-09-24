// 职责：防困小妙招工具页。
// 两页式：抽签页（只负责随机抽一条）+ 全部条目页（浏览 / 增删）。
// 抽签三种形式（翻牌 / 滚动停字 / 展签），切换器弱化为右下角小控件，用户可随时切换。
// 用户手动添加的妙招持久化到本地（services/antiDrowsyService）；内置妙招为代码常量不可删。

import { useEffect, useMemo, useRef, useState } from "react";
import { LoopIcon } from "@/components/Icons";
import { loadAntiDrowsy, saveAntiDrowsy } from "@/services/antiDrowsyService";
import { BUILTIN_TIPS } from "./tips";
import styles from "./AntiDrowsyView.module.css";

type Mode = "draw" | "list";
type Form = "flip" | "roll" | "scroll";
type Phase = "idle" | "shuffling" | "done";

const FORM_LABELS: Record<Form, string> = { flip: "翻牌", roll: "滚动停字", scroll: "展签" };
const ROLL_REPS = 6;
const LINE_H = 52;
const BACK_LABELS: Record<"A" | "B" | "C" | "D", string> = {
  A: "斜纹",
  B: "圆点",
  C: "网格",
  D: "素角标",
};

/** Fisher-Yates 洗牌：返回 0..n-1 的乱序索引数组 */
function shuffleIndices(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 基于位置生成稳定的轻微随机旋转（-4°~4°），让牌阵像随手摊开而非整齐网格 */
function tiltAt(p: number): number {
  return ((p * 53) % 9) - 4;
}

export function AntiDrowsyView({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<Mode>("draw");
  const [form, setForm] = useState<Form>("flip");
  const [userTips, setUserTips] = useState<string[]>([]);
  const [lastDrawn, setLastDrawn] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<string | null>(null);
  const [shuffleText, setShuffleText] = useState<string>("?");

  // 翻牌：牌阵，用户自行点一张
  const [flipped, setFlipped] = useState<number | null>(null);
  // 牌阵的乱序排列（pool 索引的洗牌结果），保证同一位置内容每次不同
  const [deckOrder, setDeckOrder] = useState<number[]>(() => shuffleIndices(BUILTIN_TIPS.length));
  // 牌背花纹款式：A 斜纹 / B 圆点 / C 网格 / D 素角标
  const [backStyle, setBackStyle] = useState<"A" | "B" | "C" | "D">("B");

  // 滚动停字：translateY / 过渡由 state 控制，避免 React 重渲染覆盖行内样式
  const [rollTransform, setRollTransform] = useState<string>("translateY(0)");
  const [rollTransition, setRollTransition] = useState<string>("none");

  // 展签：各阶段开关由 state 控制
  const [tubeShake, setTubeShake] = useState(false);
  const [stickUp, setStickUp] = useState(false);
  const [scrollShow, setScrollShow] = useState(false);
  const [scrollOpen, setScrollOpen] = useState(false);

  const timers = useRef<number[]>([]);
  const pool = useMemo(
    () => [...BUILTIN_TIPS.map((t) => t.text), ...userTips],
    [userTips],
  );

  useEffect(() => {
    void loadAntiDrowsy().then((d) => setUserTips(d.userTips));
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  // 切换形式 / 池变化时：翻牌模式重新洗牌，保证同位置内容不固定
  useEffect(() => {
    setFlipped(null);
    setResult(null);
    setPhase("idle");
    if (form === "flip") {
      setDeckOrder(shuffleIndices(pool.length));
    }
    if (form === "roll") {
      setRollTransition("none");
      setRollTransform("translateY(0)");
    }
  }, [form, pool.length]);

  // 翻牌：用户点一张，翻开即本次结果（i 是牌阵位置，真实索引走 deckOrder）
  const pickCard = (i: number) => {
    if (flipped !== null) return;
    const real = deckOrder[i];
    setFlipped(i);
    setResult(pool[real]);
    setLastDrawn(pool[real]);
  };

  // 翻牌：重新洗牌（复位牌阵并打乱顺序）
  const resetDeck = () => {
    setFlipped(null);
    setResult(null);
    setPhase("idle");
    setDeckOrder(shuffleIndices(pool.length));
  };

  const rand = () => pool[Math.floor(Math.random() * pool.length)];

  const finish = (final: string) => {
    setResult(final);
    setLastDrawn(final);
    setPhase("done");
  };

  const draw = () => {
    if (phase === "shuffling") return;
    const final = rand();
    setPhase("shuffling");

    if (form === "flip") {
      let n = 0;
      const iv = window.setInterval(() => {
        setShuffleText(rand());
        if (++n > 6) window.clearInterval(iv);
      }, 60);
      timers.current.push(
        window.setTimeout(() => {
          window.clearInterval(iv);
          finish(final);
        }, 480),
      );
    } else if (form === "roll") {
      setRollTransition("none");
      setRollTransform("translateY(0)");
      requestAnimationFrame(() => {
        const ci = Math.floor(Math.random() * pool.length);
        const target = (ROLL_REPS - 1) * pool.length + ci;
        setRollTransition("transform 1.2s cubic-bezier(.16,1,.3,1)");
        // 让目标行停在 3 行容器的正中（第 2 行），上下各露一行作缓冲
        setRollTransform(`translateY(${-(target - 1) * LINE_H}px)`);
      });
      timers.current.push(window.setTimeout(() => finish(final), 1260));
    } else {
      // 展签：签筒摇 → 签升起 → 卷轴展开
      setTubeShake(false);
      setStickUp(false);
      setScrollShow(false);
      setScrollOpen(false);
      requestAnimationFrame(() => {
        setTubeShake(true);
        timers.current.push(
          window.setTimeout(() => {
            setTubeShake(false);
            setResult(final);
            setStickUp(true);
            timers.current.push(
              window.setTimeout(() => {
                setScrollShow(true);
                requestAnimationFrame(() => setScrollOpen(true));
                finish(final);
              }, 600),
            );
          }, 480),
        );
      });
    }
  };

  // ---- 全部条目页：增删 ----
  const [newTip, setNewTip] = useState("");
  const persist = (next: string[]) => {
    setUserTips(next);
    void saveAntiDrowsy({ userTips: next });
  };
  const addTip = () => {
    const v = newTip.trim();
    if (!v || userTips.includes(v)) {
      setNewTip("");
      return;
    }
    persist([...userTips, v]);
    setNewTip("");
  };
  const deleteTip = (t: string) => {
    const next = userTips.filter((x) => x !== t);
    persist(next);
    if (lastDrawn === t) setLastDrawn(null);
  };

  const renderRow = (text: string, builtin: boolean, expand: boolean, idx: number) => {
    const isLast = text === lastDrawn;
    return (
      <div key={`${builtin ? "b" : "u"}-${text}`} className={isLast ? `${styles.row} ${styles.rowLast}` : styles.row}>
        <span className={styles.rowNo}>{idx + 1}</span>
        <span className={styles.rowName}>{text}</span>
        {isLast && <span className={styles.rowMark}>上次抽到</span>}
        {expand && <span className={styles.rowTag}>可展开</span>}
        {!builtin && (
          <button className={styles.rowDel} onClick={() => deleteTip(text)} title="删除">
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <button className={styles.back} onClick={onBack} title="返回工具">
          ← 工具
        </button>
        <h1 className={styles.title}>防困小妙招</h1>
        <div className={styles.seg}>
          <button className={mode === "draw" ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn} onClick={() => setMode("draw")}>
            抽签
          </button>
          <button className={mode === "list" ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn} onClick={() => setMode("list")}>
            全部条目
          </button>
        </div>
      </div>

      {mode === "draw" ? (
        <div className={styles.stage}>
          {form === "flip" && (
            <>
              <div className={styles.backSwitch}>
                <span>牌背</span>
                <button
                  type="button"
                  className={styles.backCycle}
                  onClick={() => {
                    const order: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
                    setBackStyle(order[(order.indexOf(backStyle) + 1) % order.length]);
                  }}
                  title="切换牌背花纹"
                >
                  <LoopIcon size={12} />
                  <span>{BACK_LABELS[backStyle]}</span>
                </button>
              </div>
              <div className={flipped !== null ? `${styles.deck} ${styles.deckPicked}` : styles.deck}>
                {deckOrder.map((real, p) => (
                  <button
                    key={p}
                    type="button"
                    className={flipped === p ? `${styles.card} ${styles.cardFlipped}` : styles.card}
                    style={{ transform: `rotate(${tiltAt(p)}deg)` }}
                    onClick={() => pickCard(p)}
                    disabled={flipped !== null}
                  >
                    <span className={styles.cardInner}>
                      <span className={`${styles.cardFace} ${styles.cardBack} ${styles["back" + backStyle]}`}>
                        {backStyle !== "D" && <span className={styles.cardEmblem} />}
                      </span>
                      <span className={`${styles.cardFace} ${styles.cardFront}`}>{pool[real]}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {form === "roll" && (
            <div className={styles.rollbox}>
              <div className={styles.rollinner} style={{ transform: rollTransform, transition: rollTransition }}>
                {Array.from({ length: ROLL_REPS }).flatMap((_, r) =>
                  pool.map((t, i) => (
                    <div key={`${r}-${i}`} className={styles.rollline}>
                      {t}
                    </div>
                  )),
                )}
              </div>
            </div>
          )}

          {form === "scroll" && (
            <>
              <div className={tubeShake ? `${styles.tube} ${styles.shake}` : styles.tube}>
                <div className={styles.tubeMouth} />
                <div className={stickUp ? `${styles.stick} ${styles.stickUp}` : styles.stick}>
                  <span className={styles.stickTip} />
                  <span className={styles.stickBand} />
                  <span className={styles.stickText}>签</span>
                </div>
              </div>
              <div
                className={
                  `${styles.scroll} ` +
                  (scrollShow ? `${styles.scrollShow} ` : "") +
                  (scrollOpen ? styles.scrollOpen : "")
                }
              >
                <div className={styles.rod} />
                <div className={styles.paper}>
                  <div className={styles.paperInner}>{phase !== "idle" && result ? result : "—"}</div>
                </div>
                <div className={styles.rod} />
              </div>
            </>
          )}

          {form !== "flip" && (
            <button className={styles.drawBtn} onClick={draw} disabled={phase === "shuffling"}>
              抽一个
            </button>
          )}
          {form === "flip" && flipped !== null && (
            <button className={styles.drawBtn} onClick={resetDeck}>
              重新洗牌
            </button>
          )}

          {/* 切换抽签形式：右下角单个循环按钮 */}
          <button
            className={styles.formSwitch}
            onClick={() => {
              const order: Form[] = ["flip", "roll", "scroll"];
              const next = order[(order.indexOf(form) + 1) % order.length];
              setForm(next);
            }}
            title="切换抽签形式"
          >
            <LoopIcon size={13} />
            <span>{FORM_LABELS[form]}</span>
          </button>
        </div>
      ) : (
        <div className={styles.listWrap}>
          <div className={styles.listHead}>
            <h2 className={styles.listTitle}>全部小妙招</h2>
            <span className={styles.listCount}>共 {pool.length} 条</span>
          </div>
          <div className={styles.list}>
            {BUILTIN_TIPS.map((t, i) => renderRow(t.text, true, !!t.expand, i))}
            {userTips.map((t, i) => renderRow(t, false, false, BUILTIN_TIPS.length + i))}
          </div>
          <div className={styles.add}>
            <input
              className={styles.addInput}
              value={newTip}
              placeholder="添加一条小妙招…"
              onChange={(e) => setNewTip(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTip();
              }}
            />
            <button className={styles.addBtn} onClick={addTip}>
              添加
            </button>
          </div>
          <p className={styles.note}>
            内置 {BUILTIN_TIPS.length} 条不可删；你添加的才可删。「听八卦吗」带「可展开」标记（后续支持展开）。
          </p>
        </div>
      )}
    </div>
  );
}
