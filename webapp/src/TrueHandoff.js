import { createElement } from "react";

// Let the browser follow the link normally. New-window targets can be blocked
// in embedded browsers, and an expired check must never cancel a user's click.
export function TrueHandoff({ url, label = "ไปที่ทรู" }) {
  return createElement("a", {
    className: "buy continue-link",
    href: url,
    rel: "noreferrer",
  }, label);
}
