export function PageIntro(props: {
  readonly eyebrow: string;
  readonly title: string;
  readonly summary: string;
  readonly aside?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{props.eyebrow}</p>
        <h1>{props.title}</h1>
        <p className="page-summary">{props.summary}</p>
      </div>
      {props.aside === undefined ? null : <div className="page-header-aside">{props.aside}</div>}
    </header>
  );
}
