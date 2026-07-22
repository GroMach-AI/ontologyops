(() => {
  const toast = document.querySelector("[data-toast]");
  let timer;
  const showToast = (message) => {
    if (!toast) return;
    toast.querySelector("span").textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
  };
  document.querySelectorAll("[data-toast-message]").forEach((button) => button.addEventListener("click", () => showToast(button.dataset.toastMessage)));
  document.querySelectorAll("[data-tabs]").forEach((tabs) => {
    tabs.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
      const root = tabs.closest(".card") || tabs.parentElement;
      tabs.querySelectorAll("[data-tab]").forEach((item) => { item.classList.remove("is-active"); item.setAttribute("aria-selected", "false"); });
      root.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === tab.dataset.tab));
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
    }));
  });
  document.querySelectorAll("[data-select-row]").forEach((row) => row.addEventListener("click", () => {
    const group = row.closest("tbody") || row.parentElement;
    group.querySelectorAll("[data-select-row]").forEach((item) => item.classList.remove("is-selected"));
    row.classList.add("is-selected");
  }));
  document.querySelectorAll("[data-filter]").forEach((filter) => filter.addEventListener("click", () => {
    filter.parentElement.querySelectorAll("[data-filter]").forEach((item) => item.classList.remove("is-selected"));
    filter.classList.add("is-selected");
    showToast(`已切换为「${filter.textContent.trim()}」视图。`);
  }));
  const composer = document.querySelector("[data-composer]");
  if (composer) composer.addEventListener("submit", (event) => { event.preventDefault(); showToast("原型模式：问题将进入受控工具规划，不会执行自由 SQL。 "); });
})();
