import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TrueHandoff } from "../src/TrueHandoff.js";

const url = "https://store.true.th/lucky-number/postpaid/somjade?type=all&priceplan=all&specify=803522228";
test("True handoff uses a normal same-tab link without click interception", () => {
  const link = TrueHandoff({ url });
  assert.equal(link.type, "a");
  assert.equal(link.props.href, url);
  assert.equal(link.props.target, undefined);
  assert.equal(link.props.onClick, undefined);
  assert.equal(link.props.rel, "noreferrer");
  assert.match(renderToStaticMarkup(link), /specify=803522228/);
});
test("stale checks cannot disable or replace the navigation link", () => {
  const link = TrueHandoff({ url, checkedAt: 0, expired: true });
  assert.equal(link.props.href, url);
  assert.equal(link.props.onClick, undefined);
  assert.equal(link.props.disabled, undefined);
});
