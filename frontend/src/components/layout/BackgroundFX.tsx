/**
 * 背景特效：径向渐变基底 + 网格线 + 3 个漂移光晕 + 噪点纹理
 * 参数来源：docs/style.css .bg-fx / .blob / .grid / .noise
 * 性能：页面隐藏时暂停 drift 动画（后台 GPU 零功耗）；
 *       prefers-reduced-motion 无障碍兜底见 index.css。
 */
import { useEffect, useState } from "react";

export function BackgroundFX() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden${hidden ? " fx-paused" : ""}`}
      style={{
        background:
          "radial-gradient(120% 90% at 50% -10%, var(--bg-1), var(--bg-0) 70%)",
      }}
    >
      {/* 网格线 46×46，径向遮罩淡出 */}
      <div
        className="absolute -inset-0.5"
        style={{
          backgroundImage:
            "linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
          maskImage:
            "radial-gradient(120% 80% at 50% 30%, #000 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(120% 80% at 50% 30%, #000 30%, transparent 80%)",
        }}
      />

      {/* 光晕 b1：靛蓝 */}
      <div
        className="absolute rounded-full opacity-90 animate-drift1"
        style={{
          width: "52vw",
          height: "52vw",
          left: "-12vw",
          top: "-14vw",
          background: "var(--blob1)",
          filter: "blur(90px)",
          willChange: "transform",
        }}
      />

      {/* 光晕 b2：琥珀 */}
      <div
        className="absolute rounded-full opacity-90 animate-drift2"
        style={{
          width: "40vw",
          height: "40vw",
          right: "-10vw",
          top: "8vh",
          background: "var(--blob2)",
          filter: "blur(90px)",
          willChange: "transform",
        }}
      />

      {/* 光晕 b3：青绿 */}
      <div
        className="absolute rounded-full opacity-90 animate-drift3"
        style={{
          width: "46vw",
          height: "46vw",
          left: "18vw",
          bottom: "-22vw",
          background: "var(--blob3)",
          filter: "blur(90px)",
          willChange: "transform",
        }}
      />

      {/* 噪点 */}
      <div className="noise-overlay" />
    </div>
  );
}
