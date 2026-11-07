import type { PublicQuestion } from "../../shared/types";

export const QuestionBlock = ({ q }: { q: PublicQuestion }) => {
  return (
    <>
      <p className="host-progress">第 {q.index + 1} 問 / 全 {q.total} 問</p>
      <h1 className="host-q-title">{q.title}</h1>
      {q.imageUrl && <img className="host-q-image" src={q.imageUrl} alt="" />}
    </>
  );
};
