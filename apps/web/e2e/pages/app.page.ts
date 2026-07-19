import { expect, type Locator, type Page } from "@playwright/test";

export type CampusOption = "tc" | "duluth" | "crookston" | "morris" | "rochester";
export type PrimaryRoute = "/today" | "/explore" | "/plan";

export class CampusFieldGuidePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get campusSelect(): Locator {
    return this.page.getByRole("combobox", { name: /^(Campus|校区)$/u });
  }

  get languageToggle(): Locator {
    return this.page.getByRole("button", { name: /^(中文|English)$/u });
  }

  get main(): Locator {
    return this.page.locator("#main-content");
  }

  get mainHeading(): Locator {
    return this.main.getByRole("heading", { level: 1 });
  }

  get primaryNavigation(): Locator {
    return this.page.getByRole("navigation", { name: /^(Primary navigation|主导航)$/u });
  }

  get mobileNavigation(): Locator {
    return this.page.getByRole("navigation", { name: /^(Mobile navigation|移动端导航)$/u });
  }

  async open(path = "/today"): Promise<void> {
    await this.page.goto(path);
    await expect(this.mainHeading).toBeVisible();
  }

  async chooseCampus(value: CampusOption): Promise<void> {
    await this.campusSelect.selectOption(value);
    await expect(this.campusSelect).toHaveValue(value);
  }

  primaryLink(path: PrimaryRoute): Locator {
    return this.primaryNavigation.locator(`a[href="${path}"]`);
  }

  mobileLink(path: PrimaryRoute): Locator {
    return this.mobileNavigation.locator(`a[href="${path}"]`);
  }
}
