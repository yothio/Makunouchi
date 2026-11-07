export const ResultsWaitScreen = ({ title }: { title: string }) => {
  return (
    <div className="host-results-wait">
      <p className="host-progress">結果発表</p>
      <h1 className="host-title">{title}</h1>
    </div>
  );
};
