
"""Browser smoke test using mock data. Does not access production."""
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]

# Generate 926 mock motions. No real student or club data is needed.
ROWS = [
    {
        "id": f"motion-{i:04d}",
        "motion": f"THW test motion number {i}.",
        "tournament": "テスト大会",
        "year": "2026",
        "history": [],
        "revision": 0,
        "is_deleted": False,
    }
    for i in range(1, 927)
]

MOCK_FETCH = r"""
(rows) => {
  window.__rows = rows;
  window.__mutations = [];

  window.fetch = async (path, opts = {}) => {
    let output = {};
    let status = 200;

    if (path === '/api/motions') {
      output = {
        rows: window.__rows
          .filter(r => !r.is_deleted)
          .map(({is_deleted, ...r}) => r)
      };
    } else if (path === '/api/mutate') {
      const body = JSON.parse(opts.body);
      const action = body.action;
      window.__mutations.push(action);

      if (action === 'insert') {
        window.__rows.push({
          id: 'test-new',
          ...body.row,
          revision: 0,
          is_deleted: false
        });
      } else {
        const row = window.__rows.find(r => r.id === body.id);
        if (!row) {
          return new Response(
            JSON.stringify({error: 'NOT_FOUND'}),
            {status: 404}
          );
        }
        if (action === 'delete') row.is_deleted = true;
        if (action === 'update') Object.assign(row, body.row);
        if (action === 'record') {
          row.history.push('2026-10-24T12:00:00Z');
        }
        row.revision++;
      }
      output = {ok: true};
    } else if (path === '/api/admin/deleted') {
      output = {rows: window.__rows.filter(r => r.is_deleted)};
    } else if (path === '/api/admin/restore-one') {
      const body = JSON.parse(opts.body);
      const row = window.__rows.find(r => r.id === body.id);
      row.is_deleted = false;
      row.revision++;
      output = {ok: true};
    } else if (path === '/api/admin/audit') {
      output = {rows: []};
    } else if (path === '/api/admin/backups') {
      output = {backups: []};
    } else if (path === '/api/admin/backup') {
      output = {count: window.__rows.length, key: 'test'};
    } else {
      status = 404;
      output = {error: 'Mock endpoint not found'};
    }

    return new Response(JSON.stringify(output), {
      status,
      headers: {'content-type': 'application/json'}
    });
  };
}
"""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        await page.goto("about:blank")
        await page.evaluate(MOCK_FETCH, ROWS)
        await page.set_content(
            (ROOT / "public/index.html").read_text(encoding="utf-8")
        )

        await page.get_by_text(
            "データベース接続済み・926件"
        ).wait_for()

        # Create
        await page.locator("#goManage").click()
        await page.locator("#motion").fill("THW test the new API.")
        await page.locator("#tournament").fill("テスト大会")
        await page.locator("#year").fill("2026")
        await page.locator("#preview").click()
        await page.locator("#save").click()
        await page.get_by_text(
            "データベース接続済み・927件"
        ).wait_for()

        # Edit
        await page.locator("#manageSearch").fill(
            "THW test the new API."
        )
        await page.locator("#manageList button").filter(
            has_text="編集"
        ).first.click()
        await page.locator("#motion").fill(
            "THW test edited motions."
        )
        await page.locator("#preview").click()
        await page.locator("#save").click()

        # Soft-delete
        await page.locator("#manageSearch").fill(
            "THW test edited motions."
        )
        page.once(
            "dialog",
            lambda dialog: asyncio.create_task(dialog.accept())
        )
        await page.locator("#manageList button").filter(
            has_text="削除"
        ).first.click()
        await page.get_by_text(
            "データベース接続済み・926件"
        ).wait_for()

        # Admin restore
        await page.locator("#back").click()
        await page.locator("#goAdmin").click()
        await page.locator("#adminPassword").fill(
            "mock-password-not-real"
        )
        await page.locator("#loadDeleted").click()
        await page.get_by_text(
            "1件の削除済み論題"
        ).wait_for()

        page.once(
            "dialog",
            lambda dialog: asyncio.create_task(dialog.accept())
        )
        await page.get_by_text(
            "この論題を復元"
        ).click()
        await page.get_by_text(
            "データベース接続済み・927件"
        ).wait_for()

        # Audit and backups
        await page.locator("#loadAudit").click()
        await page.get_by_text("最新0件").wait_for()
        await page.locator("#loadBackups").click()
        await page.get_by_text(
            "0件のバックアップ"
        ).wait_for()
        await page.locator("#manualBackup").click()
        await page.get_by_text(
            "927件をR2に保存しました。"
        ).wait_for()

        # Record and assign teams
        await page.locator("#back").click()
        await page.locator("#goAssign").click()
        await page.locator("#candidates button").first.click()
        await page.locator("#record").click()
        await page.get_by_text(
            "記録済み：", exact=False
        ).wait_for()

        await page.locator("#participants").fill(
            "A\nB\nC\nD\nE\nF"
        )
        await page.locator("#judges").fill("J")
        await page.locator("#pairs").select_option("1")
        await page.locator("#generate").click()
        await page.get_by_text("Match 1").wait_for()

        mutations = await page.evaluate(
            "window.__mutations"
        )
        assert mutations == [
            "insert", "update", "delete", "record"
        ], mutations
        assert not errors, errors

        await browser.close()
        print("PASS: browser smoke test")

if __name__ == "__main__":
    asyncio.run(main())
