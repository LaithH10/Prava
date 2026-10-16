// The server must refuse the app database unless explicitly allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appDatabaseGuard } from "../config/databaseGuard.js";

const url = (db) => `mongodb+srv://user:pw@cluster.example.net/${db}?retryWrites=true`;

test("refuses the app database by default", () => {
  assert.match(appDatabaseGuard(url("LystedRealEtstate"), {}), /Refusing to start/);
});

test("allows the app database only with ALLOW_APP_DATABASE=1", () => {
  assert.equal(appDatabaseGuard(url("LystedRealEtstate"), { ALLOW_APP_DATABASE: "1" }), null);
  assert.match(appDatabaseGuard(url("LystedRealEtstate"), { ALLOW_APP_DATABASE: "true" }), /Refusing/);
});

test("allows development and test databases", () => {
  assert.equal(appDatabaseGuard(url("prava_dev"), {}), null);
  assert.equal(appDatabaseGuard(url("prava_test"), {}), null);
});

test("rejects a missing or invalid URL", () => {
  assert.match(appDatabaseGuard(undefined, {}), /missing or not a valid/);
  assert.match(appDatabaseGuard("not a url", {}), /missing or not a valid/);
});
