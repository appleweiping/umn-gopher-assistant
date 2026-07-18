const campuses = [
  ["Twin Cities", "双城校区"],
  ["Duluth", "德卢斯校区"],
  ["Crookston", "克鲁克斯顿校区"],
  ["Morris", "莫里斯校区"],
  ["Rochester", "罗切斯特校区"],
] as const;

export default function FoundationPage() {
  return (
    <main>
      <section aria-labelledby="foundation-title">
        <p className="eyebrow">Platform foundation · 平台基础</p>
        <h1 id="foundation-title">Five campuses, one cautious contract.</h1>
        <p className="lede">
          This independent, unofficial project currently exposes only foundation APIs and schematic world
          manifests. Institutional connectors and safety-critical guidance remain disabled until authorized
          and verified.
        </p>
        <p lang="zh-CN" className="lede">
          本项目为独立、非官方项目。目前仅提供基础 API
          与示意校园世界清单；校方连接器及安全关键指引须经授权和核验后方可启用。
        </p>
        <ul aria-label="Supported campuses">
          {campuses.map(([englishName, chineseName]) => (
            <li key={englishName}>
              <span>{englishName}</span>
              <span lang="zh-CN">{chineseName}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
