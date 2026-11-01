import { GearIcon, HouseIcon, MagnifyingGlassIcon, StarIcon } from "@phosphor-icons/react"

export type RouteName = "following" | "home" | "search" | "settings"

type NavigationProps = {
  readonly active: RouteName
  readonly entryFocusId?: string | undefined
  readonly onNavigate: (route: RouteName) => void
  /** A newer StillStream release is out: Settings carries a dot. */
  readonly updateAvailable?: boolean
}

const items = [
  { icon: HouseIcon, label: "Home", route: "home" },
  { icon: StarIcon, label: "Following", route: "following" },
  { icon: MagnifyingGlassIcon, label: "Search", route: "search" },
] as const

// Tab order along the navigation axis (top to bottom, or left to right in the compact bar).
const order = ["nav-home", "nav-following", "nav-search", "nav-settings"] as const
const neighbours = (id: (typeof order)[number]) => {
  const index = order.indexOf(id)
  return {
    ...(index > 0 ? { "data-nav-previous": order[index - 1] } : {}),
    ...(index < order.length - 1 ? { "data-nav-next": order[index + 1] } : {}),
  }
}

const routeEntryTarget: Readonly<Record<RouteName, string>> = {
  following: "following-connect",
  home: "home-sign-in",
  search: "search-input",
  settings: "settings-sign-in",
}

export const Navigation = ({
  active,
  entryFocusId,
  onNavigate,
  updateAvailable = false,
}: NavigationProps) => (
  <nav className="navigation" aria-label="Primary">
    <div className="navigation__brand" title="StillStream">
      <img alt="" src="./logo.svg" />
      <strong>Still</strong>
    </div>
    <div className="navigation__items">
      {items.map(({ icon: Icon, label, route }) => (
        <button
          aria-current={active === route ? "page" : undefined}
          className="navigation__item"
          data-focus-down={active === route ? (entryFocusId ?? routeEntryTarget[route]) : undefined}
          data-focus-id={`nav-${route}`}
          {...neighbours(`nav-${route}`)}
          data-focus-right={
            active === route ? (entryFocusId ?? routeEntryTarget[route]) : undefined
          }
          data-focusable="true"
          key={route}
          onClick={() => onNavigate(route)}
          type="button"
        >
          <Icon aria-hidden="true" weight={active === route ? "fill" : "regular"} />
          <span>{label}</span>
        </button>
      ))}
    </div>
    <button
      aria-current={active === "settings" ? "page" : undefined}
      className="navigation__item navigation__settings"
      data-focus-down={
        active === "settings" ? (entryFocusId ?? routeEntryTarget.settings) : undefined
      }
      data-focus-id="nav-settings"
      {...neighbours("nav-settings")}
      data-focus-right={
        active === "settings" ? (entryFocusId ?? routeEntryTarget.settings) : undefined
      }
      data-focusable="true"
      onClick={() => onNavigate("settings")}
      type="button"
    >
      <GearIcon aria-hidden="true" />
      <span>Settings</span>
      {updateAvailable ? (
        <span className="navigation__badge">
          <span className="visually-hidden">, update available</span>
        </span>
      ) : null}
    </button>
  </nav>
)
