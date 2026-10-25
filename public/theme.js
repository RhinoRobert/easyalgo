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

// The header button on the static pages (the app has its own React button with the same effect): pin the opposite of what is shown.
document.addEventListener("click", function (event) {
  var target = event.target;
  var button = target && target.closest ? target.closest("[data-theme-toggle]") : null;
  if (!button) return;
  var root = document.documentElement;
  var shown = root.getAttribute("data-theme");
  if (shown !== "dark" && shown !== "light") shown = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  var next = shown === "light" ? "dark" : "light";
  root.setAttribute("data-theme", next);
  try { window.localStorage.setItem("pnet-launchlab:theme", next); } catch (error) { /* the choice lasts for this visit */ }
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", next === "light" ? "#f3f6fb" : "#08071a");
});
