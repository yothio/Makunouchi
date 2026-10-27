import type { GuestViewOf } from "../types";

export const RevealView = ({ view }: { view: GuestViewOf<"reveal"> }) => {
  return (
    <section className="center">
      <div className={`mark ${view.correct ? "ok" : "ng"}`} aria-label={view.correct ? "正解" : "不正解"}>
        {view.correct ? "⭕" : "❌"}
      </div>
      <p className="score">{view.score} 点</p>
    </section>
  );
};
