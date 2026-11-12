import { CHOICE_LABELS } from "@client/choice-labels";
import { QuestionBlock } from "@client/screen/QuestionBlock";
import type { ScreenOf } from "@client/screen/types";

export const RevealScreen = ({ screen: s }: { screen: ScreenOf<"reveal"> }) => {
  const max = Math.max(1, ...s.counts);
  return (
    <div>
      <QuestionBlock q={s.question} />
      <ul className="host-choices">
        {s.question.choices.map((c, i) => (
          <li key={i} className={`host-choice host-bar-row${i === s.correctIndex ? " correct" : ""}`}>
            <span className="host-label">{CHOICE_LABELS[i]}</span>
            <span className="host-choice-text">{c}</span>
            <span className="host-bar-track">
              <span className="host-bar" style={{ width: `${(s.counts[i]! / max) * 100}%` }} />
            </span>
            <span className="host-bar-count">{s.counts[i]}</span>
          </li>
        ))}
      </ul>
      <p className="host-answer">正解は {CHOICE_LABELS[s.correctIndex]}：{s.question.choices[s.correctIndex]}</p>
    </div>
  );
};
