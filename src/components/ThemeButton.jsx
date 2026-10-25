import { THEME_ICONS } from "../launchpad/themeIcons";
import { toggleTheme } from "../launchpad/themePrefs";

/** A small icon button for the header: one tap switches between the dark and light theme. */
export default function ThemeButton() {
  return (
    <button type="button" className="theme-btn" onClick={toggleTheme} title="Switch between dark and light theme" aria-label="Switch between dark and light theme" dangerouslySetInnerHTML={{ __html: THEME_ICONS }} />
  );
}