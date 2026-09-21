declare module "virtual:docs-nav" {
  export interface NavItem {
    slug: string;
    label: string;
  }
  export interface NavSection {
    label: string;
    items: NavItem[];
  }
  const nav: NavSection[];
  export default nav;
}
