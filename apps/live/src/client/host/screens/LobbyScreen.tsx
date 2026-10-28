import { QRCodeSVG } from "qrcode.react";

export const LobbyScreen = ({
  title,
  playerCount,
  sessionId,
}: {
  title: string;
  playerCount: number;
  sessionId: string;
}) => {
  const url = `${window.location.origin}/s/${sessionId}`;
  return (
    <div className="host-lobby">
      <h1 className="host-title">{title}</h1>
      <QRCodeSVG value={url} size={360} marginSize={2} />
      <p className="host-url">{url}</p>
      <p className="host-count">参加人数 {playerCount} 人</p>
    </div>
  );
};
