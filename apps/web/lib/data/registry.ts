export const campusIds = ["tc", "duluth", "crookston", "morris", "rochester"] as const;

export type CampusId = (typeof campusIds)[number];
export type Locale = "en" | "zh-CN";
export type AcademicInstitutionCode = "UMNTC" | "UMNDL" | "UMNCR" | "UMNMO";
export type DemoKind =
  | "calendar"
  | "map"
  | "transit"
  | "dining"
  | "events"
  | "library"
  | "safety"
  | "service";
export type Licensing = "OPEN_REUSE" | "DEEPLINK_ONLY" | "LIVE_ONLY" | "APPROVAL_REQUIRED";
export type Freshness = "fresh" | "aging" | "stale" | "unknown";

export interface LocalizedText {
  readonly en: string;
  readonly "zh-CN": string;
}

export interface Campus {
  readonly id: CampusId;
  readonly name: LocalizedText;
  readonly city: LocalizedText;
  readonly academicInstitutionCode: AcademicInstitutionCode;
}

export interface DemoRecord {
  readonly id: string;
  readonly campus: CampusId;
  readonly kind: DemoKind;
  readonly title: LocalizedText;
  readonly source: {
    readonly label: LocalizedText;
    readonly url: string;
    readonly publisher: "University of Minnesota";
  };
  readonly licensing: Licensing;
  readonly freshness: Freshness;
  readonly updatedAt: string;
}

export const campuses = [
  {
    id: "tc",
    name: { en: "Twin Cities", "zh-CN": "双城校区" },
    city: { en: "Minneapolis & Saint Paul", "zh-CN": "明尼阿波利斯与圣保罗" },
    academicInstitutionCode: "UMNTC",
  },
  {
    id: "duluth",
    name: { en: "Duluth", "zh-CN": "德卢斯校区" },
    city: { en: "Duluth", "zh-CN": "德卢斯" },
    academicInstitutionCode: "UMNDL",
  },
  {
    id: "crookston",
    name: { en: "Crookston", "zh-CN": "克鲁克斯顿校区" },
    city: { en: "Crookston", "zh-CN": "克鲁克斯顿" },
    academicInstitutionCode: "UMNCR",
  },
  {
    id: "morris",
    name: { en: "Morris", "zh-CN": "莫里斯校区" },
    city: { en: "Morris", "zh-CN": "莫里斯" },
    academicInstitutionCode: "UMNMO",
  },
  {
    id: "rochester",
    name: { en: "Rochester", "zh-CN": "罗切斯特校区" },
    city: { en: "Rochester", "zh-CN": "罗切斯特" },
    academicInstitutionCode: "UMNTC",
  },
] as const satisfies readonly Campus[];

function demo(
  id: string,
  campus: CampusId,
  kind: DemoKind,
  title: LocalizedText,
  sourceLabel: LocalizedText,
  url: string,
  licensing: Licensing = "DEEPLINK_ONLY",
  freshness: Freshness = "fresh",
): DemoRecord {
  return {
    id,
    campus,
    kind,
    title,
    source: { label: sourceLabel, url, publisher: "University of Minnesota" },
    licensing,
    freshness,
    updatedAt: "2026-07-19T00:00:00.000Z",
  };
}

export const demoRecords = [
  demo(
    "tc-calendar",
    "tc",
    "calendar",
    { en: "Academic calendar", "zh-CN": "校历" },
    { en: "Twin Cities One Stop", "zh-CN": "双城 One Stop" },
    "https://onestop.umn.edu/calendar/academic-calendar",
  ),
  demo(
    "tc-map",
    "tc",
    "map",
    { en: "Campus maps", "zh-CN": "校园地图" },
    { en: "Campus Maps", "zh-CN": "UMN 校园地图" },
    "https://campusmaps.umn.edu/",
  ),
  demo(
    "tc-transit",
    "tc",
    "transit",
    { en: "Campus transit", "zh-CN": "校园交通" },
    { en: "Parking & Transportation Services", "zh-CN": "停车与交通服务" },
    "https://pts.umn.edu/transit/campus",
    "LIVE_ONLY",
  ),
  demo(
    "tc-dining",
    "tc",
    "dining",
    { en: "M Food Co", "zh-CN": "校园餐饮" },
    { en: "M Food Co", "zh-CN": "M Food Co" },
    "https://dining.tc.umn.edu/",
    "DEEPLINK_ONLY",
    "unknown",
  ),
  demo(
    "tc-events-feed",
    "tc",
    "events",
    { en: "Campus events feed", "zh-CN": "校园活动订阅" },
    { en: "Twin Cities Events", "zh-CN": "双城校区活动" },
    "https://events.tc.umn.edu/feed_builder",
    "OPEN_REUSE",
  ),

  demo(
    "duluth-calendar",
    "duluth",
    "calendar",
    { en: "Academic calendar", "zh-CN": "校历" },
    { en: "Duluth One Stop", "zh-CN": "德卢斯 One Stop" },
    "https://onestop.d.umn.edu/calendar/academic-calendar",
  ),
  demo(
    "duluth-map",
    "duluth",
    "map",
    { en: "Campus maps", "zh-CN": "校园地图" },
    { en: "UMD Campus Maps", "zh-CN": "UMD 校园地图" },
    "https://www.d.umn.edu/maps/",
  ),
  demo(
    "duluth-transit",
    "duluth",
    "transit",
    { en: "Transportation & parking", "zh-CN": "交通与停车" },
    { en: "UMD Transportation & Parking", "zh-CN": "UMD 交通与停车" },
    "https://tps.d.umn.edu/",
    "LIVE_ONLY",
  ),
  demo(
    "duluth-dining",
    "duluth",
    "dining",
    { en: "Dining locations & menus", "zh-CN": "餐饮地点与菜单" },
    { en: "UMD Dining Services", "zh-CN": "UMD 餐饮服务" },
    "https://dining-services.d.umn.edu/locations-and-menus",
    "DEEPLINK_ONLY",
    "aging",
  ),
  demo(
    "duluth-events-feed",
    "duluth",
    "events",
    { en: "Public events JSON", "zh-CN": "公开活动 JSON" },
    { en: "UMD Events Calendar", "zh-CN": "UMD 活动日历" },
    "https://calendar.d.umn.edu/live/json/events",
    "OPEN_REUSE",
  ),

  demo(
    "crookston-calendar",
    "crookston",
    "calendar",
    { en: "Official academic calendars", "zh-CN": "官方校历" },
    { en: "Crookston Registrar", "zh-CN": "克鲁克斯顿注册办公室" },
    "https://crk.umn.edu/registrar/official-academic-calendar",
  ),
  demo(
    "crookston-map",
    "crookston",
    "map",
    { en: "Campus maps & directions", "zh-CN": "校园地图与路线" },
    { en: "UMN Crookston", "zh-CN": "UMN 克鲁克斯顿" },
    "https://crk.umn.edu/campus-maps-and-directions",
    "DEEPLINK_ONLY",
    "aging",
  ),
  demo(
    "crookston-transit",
    "crookston",
    "transit",
    { en: "Transportation & lodging", "zh-CN": "交通与住宿" },
    { en: "UMN Crookston", "zh-CN": "UMN 克鲁克斯顿" },
    "https://crk.umn.edu/transportation-and-lodging",
    "LIVE_ONLY",
    "unknown",
  ),
  demo(
    "crookston-dining",
    "crookston",
    "dining",
    { en: "Housing & meal plans", "zh-CN": "住宿与餐饮计划" },
    { en: "Crookston Residential Life", "zh-CN": "克鲁克斯顿住宿生活" },
    "https://crk.umn.edu/residential-life/campus-housing-options",
    "DEEPLINK_ONLY",
    "unknown",
  ),
  demo(
    "crookston-events",
    "crookston",
    "events",
    { en: "Campus events", "zh-CN": "校园活动" },
    { en: "Crookston University Relations", "zh-CN": "克鲁克斯顿校务关系" },
    "https://crk.umn.edu/university-relations/events",
    "APPROVAL_REQUIRED",
    "unknown",
  ),

  demo(
    "morris-calendar",
    "morris",
    "calendar",
    { en: "Academic calendar", "zh-CN": "校历" },
    { en: "Morris One Stop", "zh-CN": "莫里斯 One Stop" },
    "https://onestop.morris.umn.edu/calendar/academic-calendar",
  ),
  demo(
    "morris-map",
    "morris",
    "map",
    { en: "Campus maps", "zh-CN": "校园地图" },
    { en: "UMN Morris", "zh-CN": "UMN 莫里斯" },
    "https://morris.umn.edu/maps",
  ),
  demo(
    "morris-transit",
    "morris",
    "transit",
    { en: "Parking & transportation", "zh-CN": "停车与交通" },
    { en: "UMN Morris", "zh-CN": "UMN 莫里斯" },
    "https://morris.umn.edu/about-morris/visitor-information/parking-and-transportation",
    "LIVE_ONLY",
  ),
  demo(
    "morris-dining",
    "morris",
    "dining",
    { en: "Hours of operation", "zh-CN": "餐饮营业时间" },
    { en: "UMN Morris", "zh-CN": "UMN 莫里斯" },
    "https://morris.umn.edu/about-morris/visitor-information/hours-operation",
    "DEEPLINK_ONLY",
    "unknown",
  ),
  demo(
    "morris-events-feed",
    "morris",
    "events",
    { en: "Public events JSON", "zh-CN": "公开活动 JSON" },
    { en: "Morris Events", "zh-CN": "莫里斯活动" },
    "https://events.morris.umn.edu/api/2/events",
    "OPEN_REUSE",
  ),

  demo(
    "rochester-calendar",
    "rochester",
    "calendar",
    { en: "Academic calendar (UMNTC)", "zh-CN": "校历（UMNTC）" },
    { en: "Rochester One Stop", "zh-CN": "罗切斯特 One Stop" },
    "https://onestop.r.umn.edu/calendar/academic-calendar",
  ),
  demo(
    "rochester-map",
    "rochester",
    "map",
    { en: "Downtown campus map", "zh-CN": "市中心校园地图" },
    { en: "UMN Rochester", "zh-CN": "UMN 罗切斯特" },
    "https://r.umn.edu/admissions/campus-tours-visits/campus-map",
  ),
  demo(
    "rochester-transit",
    "rochester",
    "transit",
    { en: "Student parking & transportation", "zh-CN": "学生停车与交通" },
    { en: "UMN Rochester", "zh-CN": "UMN 罗切斯特" },
    "https://r.umn.edu/student-life/student-parking-and-transportation",
    "LIVE_ONLY",
  ),
  demo(
    "rochester-dining",
    "rochester",
    "dining",
    { en: "Raptor Eats", "zh-CN": "Raptor Eats 餐饮" },
    { en: "UMN Rochester", "zh-CN": "UMN 罗切斯特" },
    "https://r.umn.edu/student-life/raptor-eats/raptor-eats-dining-services-overview",
    "DEEPLINK_ONLY",
    "unknown",
  ),
  demo(
    "rochester-events",
    "rochester",
    "events",
    { en: "RaptorLink events", "zh-CN": "RaptorLink 活动" },
    { en: "UMN Rochester RaptorLink", "zh-CN": "UMN 罗切斯特 RaptorLink" },
    "https://raptorlink.umn.edu/events",
    "LIVE_ONLY",
    "unknown",
  ),

  demo(
    "tc-library",
    "tc",
    "library",
    { en: "University Libraries", "zh-CN": "大学图书馆" },
    { en: "University Libraries", "zh-CN": "大学图书馆" },
    "https://www.lib.umn.edu/",
    "DEEPLINK_ONLY",
    "aging",
  ),
  demo(
    "tc-safety",
    "tc",
    "safety",
    { en: "Current safety alerts", "zh-CN": "当前安全警报" },
    { en: "Public Safety", "zh-CN": "公共安全部门" },
    "https://publicsafety.umn.edu/alerts",
    "LIVE_ONLY",
  ),
  demo(
    "tc-service",
    "tc",
    "service",
    { en: "One Stop how-to guides", "zh-CN": "One Stop 办事指南" },
    { en: "Twin Cities One Stop", "zh-CN": "双城 One Stop" },
    "https://onestop.umn.edu/how-guide-resource-page",
    "DEEPLINK_ONLY",
    "aging",
  ),

  demo(
    "duluth-library",
    "duluth",
    "library",
    { en: "Kathryn A. Martin Library", "zh-CN": "Kathryn A. Martin 图书馆" },
    { en: "UMD Library", "zh-CN": "UMD 图书馆" },
    "https://lib.d.umn.edu/",
    "DEEPLINK_ONLY",
    "aging",
  ),
  demo(
    "duluth-safety",
    "duluth",
    "safety",
    { en: "Emergency current status", "zh-CN": "紧急状态" },
    { en: "UMD Emergency", "zh-CN": "UMD 紧急信息" },
    "https://emergency.d.umn.edu/",
    "LIVE_ONLY",
  ),
  demo(
    "duluth-service",
    "duluth",
    "service",
    { en: "One Stop how-to guides", "zh-CN": "One Stop 办事指南" },
    { en: "Duluth One Stop", "zh-CN": "德卢斯 One Stop" },
    "https://onestop.d.umn.edu/how-guide-resource-page",
    "DEEPLINK_ONLY",
    "aging",
  ),

  demo(
    "crookston-library",
    "crookston",
    "library",
    { en: "Roger D. Moe Library", "zh-CN": "Roger D. Moe 图书馆" },
    { en: "Crookston Library", "zh-CN": "克鲁克斯顿图书馆" },
    "https://crk.umn.edu/library",
    "DEEPLINK_ONLY",
    "aging",
  ),
  demo(
    "crookston-safety",
    "crookston",
    "safety",
    { en: "SAFE-U notification", "zh-CN": "SAFE-U 通知" },
    { en: "Crookston Public Safety", "zh-CN": "克鲁克斯顿公共安全" },
    "https://crk.umn.edu/public-safety/safe-u",
    "LIVE_ONLY",
    "unknown",
  ),
  demo(
    "crookston-service",
    "crookston",
    "service",
    { en: "One Stop how-to guides", "zh-CN": "One Stop 办事指南" },
    { en: "Crookston One Stop", "zh-CN": "克鲁克斯顿 One Stop" },
    "https://onestop.crk.umn.edu/how-guide-resource-page",
    "DEEPLINK_ONLY",
    "aging",
  ),

  demo(
    "morris-library",
    "morris",
    "library",
    { en: "Rodney A. Briggs Library", "zh-CN": "Rodney A. Briggs 图书馆" },
    { en: "Morris Library", "zh-CN": "莫里斯图书馆" },
    "https://library.morris.umn.edu/",
    "DEEPLINK_ONLY",
    "aging",
  ),
  demo(
    "morris-safety",
    "morris",
    "safety",
    { en: "Morris SAFE-U", "zh-CN": "莫里斯 SAFE-U" },
    { en: "UMN Morris", "zh-CN": "UMN 莫里斯" },
    "https://morris.umn.edu/safeu",
    "LIVE_ONLY",
    "unknown",
  ),
  demo(
    "morris-service",
    "morris",
    "service",
    { en: "Morris One Stop", "zh-CN": "莫里斯 One Stop" },
    { en: "Morris One Stop", "zh-CN": "莫里斯 One Stop" },
    "https://onestop.morris.umn.edu/",
    "DEEPLINK_ONLY",
    "aging",
  ),

  demo(
    "rochester-library",
    "rochester",
    "library",
    { en: "Library and Information Commons", "zh-CN": "图书馆与信息共享空间" },
    { en: "UMN Rochester", "zh-CN": "UMN 罗切斯特" },
    "https://r.umn.edu/student-life/library-and-information-commons",
    "DEEPLINK_ONLY",
    "aging",
  ),
  demo(
    "rochester-safety",
    "rochester",
    "safety",
    { en: "Campus safety overview", "zh-CN": "校园安全概览" },
    { en: "UMN Rochester", "zh-CN": "UMN 罗切斯特" },
    "https://r.umn.edu/student-life/campus-safety/campus-safety-and-community-standards-overview",
    "LIVE_ONLY",
    "unknown",
  ),
  demo(
    "rochester-service",
    "rochester",
    "service",
    { en: "Student services", "zh-CN": "学生服务" },
    { en: "UMN Rochester", "zh-CN": "UMN 罗切斯特" },
    "https://r.umn.edu/student-services",
    "DEEPLINK_ONLY",
    "aging",
  ),
] as const satisfies readonly DemoRecord[];

export function getCampus(id: CampusId): Campus {
  const campus = campuses.find((candidate) => candidate.id === id);
  if (campus === undefined) throw new Error(`Unknown campus: ${id}`);
  return campus;
}
