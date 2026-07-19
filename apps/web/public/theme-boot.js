(() => {
  try {
    const themeCookie = document.cookie
      .split(";")
      .map((entry) => entry.trim().split("="))
      .find(([name]) => name === "theme");
    const preference = themeCookie ? decodeURIComponent(themeCookie.slice(1).join("=")) : "system";
    const theme =
      preference === "light" || preference === "dark"
        ? preference
        : matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
