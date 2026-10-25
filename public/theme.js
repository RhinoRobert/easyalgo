// Applies the visitor's saved theme before the page paints, so there is no flash. "auto" (nothing saved) follows the system setting through CSS.
// Kept as a separate file, with no inline code, so the site's content security policy does not need to allow inline scripts.
(function () {
  try {
    var choice = window.localStorage.getItem("pnet-launchlab:theme");
    if (choice !== "dark" && choice !== "light") return;
    document.documentElement.setAttribute("data-theme", choice);
    var colour = choice === "light" ? "#f3f6fb" : "#08071a";
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", colour);
  } catch (error) { /* storage blocked: follow the system setting */ }
})();