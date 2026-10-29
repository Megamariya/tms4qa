import { mediaKind, mediaName } from "../utils/media";

type Props = {
  url: string;
  className?: string;
  /** клик по картинке (обычно — открыть lightbox) */
  onOpen?: (url: string) => void;
};

/** Превью вложения: картинка, видео с плеером или ссылка на файл (PDF и пр.). */
export default function MediaThumb({ url, className, onOpen }: Props) {
  const kind = mediaKind(url);
  if (kind === "video") {
    return (
      <video src={url} className={className} controls preload="metadata"
        style={{ objectFit: "contain", background: "#000" }} />
    );
  }
  if (kind === "file") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={className} title={mediaName(url)}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11,
          textAlign: "center", padding: 4, overflow: "hidden", wordBreak: "break-all", textDecoration: "none" }}>
        📄 {mediaName(url)}
      </a>
    );
  }
  return <img src={url} alt="" className={className} onClick={onOpen ? () => onOpen(url) : undefined} />;
}
