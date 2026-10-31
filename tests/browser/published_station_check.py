import asyncio, json, sys, time, subprocess, os
sys.path.insert(0,"/tmp/browser/p3")
from aal2_login import totp
from playwright.async_api import async_playwright
BASE="https://pixel-perfect-screenshot-maker-52.lovable.app"
ENV=dict(os.environ, ND_STATE_DIR="/tmp/browser/pub/state", ND_CONFIG="/tmp/browser/pub/state/station.json", ND_SYSROOT="/tmp/browser/pub/sysroot")
def station_once():
    r=subprocess.run([sys.executable,"-m","nd_station","headless","--once"],cwd="/dev-server/agent-handoff/station",env=ENV,capture_output=True,text=True)
    out=r.stdout[r.stdout.find("{"):]; 
    try: return json.loads(out)
    except Exception: return {"raw": (r.stdout+r.stderr)[-300:]}
async def main():
    t=json.load(open("/tmp/browser/p3/totp.json")); pw=open("/tmp/browser/p3/qa_pw").read()
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True); pg=await (await b.new_context(viewport={"width":1280,"height":1800})).new_page()
        await pg.goto(BASE+"/auth", wait_until="networkidle")
        await pg.fill("#email","nextdrive.qa.uts@mailinator.com"); await pg.fill("#password",pw)
        await pg.get_by_role("button", name="Sign in", exact=True).click(); await pg.wait_for_selector("#code")
        await pg.fill("#code", totp(t["secret"])); await pg.get_by_role("button", name="Verify").click(); await pg.wait_for_url("**/app**"); await asyncio.sleep(2)
        await pg.goto(BASE+"/app/agents", wait_until="networkidle"); await asyncio.sleep(3)
        row=pg.locator("tr", has_text="Published pilot check").first
        print("station row:", " | ".join((await row.inner_text()).split("\n"))[:200])
        sec=pg.locator("section[aria-labelledby=disc-h]")
        drow=sec.locator("div,li,article").filter(has_text="S/N PUBCHECK-0001").filter(has=pg.get_by_role("button", name="Add to inventory")).last
        print("discovery row:", " | ".join((await drow.inner_text()).split("\n"))[:700])
        await pg.screenshot(path="3_agents.png")
        await drow.get_by_role("button", name="Add to inventory").click()
        tag="PUBCHECK-"+str(int(time.time()))[-5:]
        await pg.fill("#asset_tag", tag); await pg.locator("[role=dialog]").get_by_role("button", name="Add to inventory").click(); await asyncio.sleep(3)
        print("station after add:", station_once())
        await pg.goto(BASE+"/app/inventory", wait_until="networkidle"); await asyncio.sleep(2)
        await pg.get_by_text(tag).first.click(); await pg.wait_for_load_state("networkidle"); await asyncio.sleep(2)
        main_txt=await pg.locator("main").inner_text()
        print("device page: station-verified shown:", "tation-verified" in main_txt or "tation verified" in main_txt)
        await pg.get_by_role("tab", name="Drives").click(); await asyncio.sleep(1)
        dtxt=await pg.locator("main").inner_text()
        print("drives: NVMe listed", "PUBCHECKNVME01" in dtxt, "| SATA listed", "S3Z9NB0K000001" in dtxt, "| boot stick listed", "4C530001234567" in dtxt, "| other USB listed", "OTHERSTICK01" in dtxt)
        await pg.screenshot(path="4_device.png")
        print("restart/re-report:", station_once())
        await pg.goto(BASE+"/app/agents", wait_until="networkidle"); await asyncio.sleep(2)
        drow=pg.locator("section[aria-labelledby=disc-h] div").filter(has_text="S/N PUBCHECK-0001").last
        print("discovery row now:", " | ".join((await drow.inner_text()).split("\n"))[:700])
        row=pg.locator("tr", has_text="Published pilot check").first
        await row.get_by_role("button", name="Revoke").click(); await pg.get_by_role("button", name="Revoke agent").click(); await asyncio.sleep(3)
        print("station row after revoke:", " | ".join((await pg.locator("tr", has_text="Published pilot check").first.inner_text()).split("\n"))[:200])
        print("station after revoke:", station_once())
        print("credential file still present:", os.path.exists("/tmp/browser/pub/state/credential") , os.listdir("/tmp/browser/pub/state"))
        await b.close()
asyncio.run(main())
