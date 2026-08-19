export interface PageElementState {
  i: number;
  tag: string;
  type: string | null;
  text: string;
  aria: string | null;
  href: string | null;
  inViewport: boolean;
}

export interface PageState {
  url: string;
  title: string;
  scrollY: number;
  scrollHeight: number;
  innerHeight: number;
  elements: PageElementState[];
  textDigest: string;
}
