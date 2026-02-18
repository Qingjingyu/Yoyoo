const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const checks = Number.parseInt(process.env.SMOKE_CHECKS || "50", 10);

function fail(message) {
    console.error(`[smoke:css] FAIL: ${message}`);
    process.exit(1);
}

function pass(message) {
    console.log(`[smoke:css] ${message}`);
}

async function main() {
    const homeRes = await fetch(`${baseUrl}/`);
    if (!homeRes.ok) {
        fail(`home status ${homeRes.status}`);
    }

    const html = await homeRes.text();
    const match = html.match(/href="([^"]*\.css[^"]*)"/);
    if (!match?.[1]) {
        fail("css url not found in home html");
    }

    const cssUrl = match[1].startsWith("http")
        ? match[1]
        : `${baseUrl}${match[1]}`;

    for (let i = 1; i <= checks; i += 1) {
        const res = await fetch(cssUrl);
        if (!res.ok) {
            fail(`css request ${i}/${checks} status ${res.status}`);
        }
    }

    pass(`css stable (${checks} requests, all 200)`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
