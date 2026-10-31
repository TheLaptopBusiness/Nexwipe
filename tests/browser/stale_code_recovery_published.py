import asyncio, json, re
from playwright.async_api import async_playwright
SECRETS=["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.c2lnbmF0dXJlc2lnbmF0dXJlc2ln","ndagt_9f2c1a7e5b3d4c6e8f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e"]
CHUNK=re.compile(r"/assets/app\.sites-[^/]+\.js")
BOOT=re.compile(r"/assets/index-[^/]+\.js")
m=json.load(open("/tmp/browser/p3/aal2_session.json"))

async def setup(p, mode):
    b=await p.chromium.launch(headless=True); ctx=await b.new_context(viewport={"width":1280,"height":1800}); pg=await ctx.new_page()
    st={"loads":0,"blocked":0,"mode":mode,"console":[]}
    pg.on("request", lambda r: st.__setitem__("loads", st["loads"]+1) if r.resource_type=="document" and r.frame==pg.main_frame else None)
    pg.on("console", lambda x: st["console"].append(x.text))
    async def handler(route):
        if st["mode"]=="block":
            st["blocked"]+=1; await route.abort("failed")
        elif st["mode"]=="render_once":
            await route.fulfill(status=200, content_type="application/javascript",
                body='export function component(){ if(!window.__ndArmed){ window.__ndArmed=0; } if(window.__ndArmed===0){ throw new Error("Controlled render failure ?access_token=abc123def456ghi"); } return null; }')
        elif st["mode"]=="throw":
            st["blocked"]+=1
            await route.fulfill(status=200, content_type="application/javascript",
                body=f'throw new Error("Controlled application failure Bearer {SECRETS[0]} cred {SECRETS[1]} user jane.doe@example.com");')
        else:
            await route.continue_()
    await pg.route(CHUNK, handler)
    async def boot_handler(route):
        if st.get("boot") in ("block","block_once"):
            st["boot_blocked"]=st.get("boot_blocked",0)+1
            if st["boot"]=="block_once": st["boot"]="pass"   # the new version becomes available right after the first failure
            await route.abort("failed")
        else:
            await route.continue_()
    await pg.route(BOOT, boot_handler)
    await pg.goto("https://pixel-perfect-screenshot-maker-52.lovable.app"); await pg.evaluate("([k,v])=>localStorage.setItem(k,v)", [m["storage_key"], json.dumps(m["session"])])
    return b, pg, st

async def goto_app(pg, path="/app"):
    await pg.goto("https://pixel-perfect-screenshot-maker-52.lovable.app"+path, wait_until="networkidle"); await asyncio.sleep(2)

async def main():
    res={}
    async with async_playwright() as p:
        # A: outdated code once -> reload once -> recovers
        b,pg,st=await setup(p,"block"); await goto_app(pg); base=st["loads"]
        async def unblock_after_first(route): pass
        await pg.get_by_role("link", name="Sites").click()
        # let the first failure happen, then "deploy finished": serve the file again
        for _ in range(40):
            await asyncio.sleep(0.25)
            if st["blocked"]>=1: break
        st["mode"]="pass"
        await asyncio.sleep(8)
        guard=await pg.evaluate("sessionStorage.getItem('nd.staleCodeReloadAt')")
        txt=await pg.locator("body").inner_text()
        res["A_reloads"]=st["loads"]-base; res["A_on_sites"]=("Sites" in txt and "didn't load" not in txt and "newer version" not in txt); res["A_url"]=pg.url; res["A_guard_set"]=bool(guard)
        await pg.screenshot(path="pubshots/A_recovered.png"); await b.close()

        # B: failure persists -> exactly one reload, then fallback, no loop
        b,pg,st=await setup(p,"block"); await goto_app(pg); base=st["loads"]
        await pg.get_by_role("link", name="Sites").click(); await asyncio.sleep(20)
        txt=await pg.locator("body").inner_text()
        res["B_reloads"]=st["loads"]-base; res["B_fallback"]="could not be loaded automatically" in txt; res["B_reload_button"]=await pg.get_by_role("button", name="Reload page").count()
        await pg.screenshot(path="pubshots/B_fallback.png")
        # manual retry after the problem is fixed
        st["mode"]="pass"; await pg.get_by_role("button", name="Reload page").click(); await asyncio.sleep(8)
        txt=await pg.locator("body").inner_text()
        res["B_manual_reload_recovers"]="could not be loaded" not in txt and "Sites" in txt
        await b.close()

        # C: unsaved work -> ask, no automatic reload
        b,pg,st=await setup(p,"block"); await goto_app(pg,"/app/account"); base=st["loads"]
        await pg.fill("#full_name","Typed but not saved"); await asyncio.sleep(0.5)
        await pg.get_by_role("link", name="Sites").click(); await asyncio.sleep(12)
        txt=await pg.locator("body").inner_text()
        res["C_reloads"]=st["loads"]-base; res["C_asks"]="hasn't been saved" in txt; res["C_guard_unused"]=(await pg.evaluate("sessionStorage.getItem('nd.staleCodeReloadAt')")) is None
        await pg.screenshot(path="pubshots/C_unsaved.png"); await b.close()

        # D: ordinary application error -> fallback, no reload, safe diagnostics, manual retry
        b,pg,st=await setup(p,"throw"); await goto_app(pg); base=st["loads"]
        await pg.get_by_role("link", name="Sites").click(); await asyncio.sleep(12)
        txt=await pg.locator("body").inner_text()
        res["D_reloads"]=st["loads"]-base; res["D_fallback"]="Something went wrong while showing this page" in txt; res["D_try_again"]=await pg.get_by_role("button", name="Try again").count()
        await pg.get_by_text("Details for support").click(); await asyncio.sleep(0.5)
        diag=await pg.get_by_test_id("error-diagnostics").inner_text()
        stored=await pg.evaluate("sessionStorage.getItem('nd.lastErrorDiagnostics')") or ""
        logged="\n".join(st["console"])
        ours="\n".join(l for l in st["console"] if l.startswith("[NextDrive]"))
        leak=[s for s in SECRETS+["jane.doe@example.com"] if s in diag or s in stored or s in ours]
        res["D_raw_error_in_framework_dev_console"]=any(s in logged for s in SECRETS)
        res["D_diag_has_reference"]="Reference:" in diag and "Controlled application failure" in diag
        res["D_secrets_leaked"]=leak; res["D_redacted_marker"]="[redacted" in diag; res["D_stored"]=bool(stored)
        await pg.screenshot(path="pubshots/D_fallback.png")
        st["mode"]="pass"; await pg.get_by_role("button", name="Try again").click(); await asyncio.sleep(6)
        txt=await pg.locator("body").inner_text()
        res["D_try_again_result"]="recovered" if ("Something went wrong" not in txt and "Sites" in txt) else "same error shown again"
        res["D_reloads_after_try"]=st["loads"]-base
        await b.close()
        # F: ordinary render error, manual Try again succeeds without reloading
        b,pg,st=await setup(p,"render_once"); await goto_app(pg); base=st["loads"]
        await pg.get_by_role("link", name="Sites").click(); await asyncio.sleep(6)
        txt=await pg.locator("body").inner_text()
        res["F_fallback"]="Something went wrong while showing this page" in txt
        await pg.get_by_text("Details for support").click()
        res["F_token_redacted"]="abc123def456ghi" not in await pg.get_by_test_id("error-diagnostics").inner_text()
        await pg.evaluate("window.__ndArmed=1")  # the underlying problem is fixed
        await pg.get_by_role("button", name="Try again").click(); await asyncio.sleep(5)
        txt=await pg.locator("body").inner_text()
        res["F_try_again_recovers"]="Something went wrong" not in txt and "Dashboard" in txt and pg.url.endswith("/app/sites")
        res["F_reloads"]=st["loads"]-base
        await b.close()
        # E1: start-up load fails once (blank-screen case) -> one reload -> app loads
        b,pg,st=await setup(p,"pass"); st["boot"]="block_once"; base=st["loads"]
        await pg.goto("https://pixel-perfect-screenshot-maker-52.lovable.app/app", wait_until="domcontentloaded")
        for _ in range(40):
            await asyncio.sleep(0.25)
            if st.get("boot_blocked",0)>=1: break
        st["boot"]="pass"; await asyncio.sleep(10)
        txt=await pg.locator("body").inner_text()
        res["E1_reloads"]=st["loads"]-base-1; res["E1_app_loaded"]="Dashboard" in txt
        await b.close()
        # E2: start-up failure persists -> one reload, then visible fallback (not blank), no loop; manual reload recovers
        b,pg,st=await setup(p,"pass"); st["boot"]="block"; base=st["loads"]
        await pg.goto("https://pixel-perfect-screenshot-maker-52.lovable.app/app", wait_until="domcontentloaded"); await asyncio.sleep(20)
        res["E2_reloads"]=st["loads"]-base-1
        res["E2_fallback_visible"]=await pg.locator("#nd-boot-fallback").count()
        await pg.screenshot(path="pubshots/E2_boot_fallback.png")
        st["boot"]="pass"; await pg.locator("#nd-boot-reload").click(); await asyncio.sleep(10)
        res["E2_manual_reload_recovers"]="Dashboard" in await pg.locator("body").inner_text()
        await b.close()
    print(json.dumps(res, indent=1))
asyncio.run(main())
