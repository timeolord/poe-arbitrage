import argparse
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request


def fetch_snapshot(realm, hour):
    suffix = "" if realm == "pc" else f"/{realm}"
    url = f"https://web.poecdn.com/api/currency-exchange{suffix}/{hour}"
    request = urllib.request.Request(url, headers={"User-Agent": "poe-arbitrage/0.1 (contact: https://github.com/timeolord/poe-arbitrage)"})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = json.load(response)
    if data.get("next_change_id", hour) <= hour:
        raise ValueError("the requested hour has not been published yet")
    if not isinstance(data.get("markets"), list):
        raise ValueError("unexpected exchange response")
    return {**data, "hour": hour, "realm": realm, "source_url": url, "fetched_at": int(time.time())}


def main():
    parser = argparse.ArgumentParser(description="fetch one completed GGG exchange hour")
    parser.add_argument("--realm", choices=["pc", "xbox", "sony", "poe2"], default="pc")
    parser.add_argument("--hour", type=int)
    parser.add_argument("--output", type=Path, default=Path("data/snapshot.json"))
    args = parser.parse_args()
    hour = args.hour if args.hour is not None else (int(time.time()) // 3600 - 1) * 3600
    if hour < 0 or hour % 3600:
        parser.error("hour must be a nonnegative unix timestamp on an hourly boundary")
    try:
        snapshot = fetch_snapshot(args.realm, hour)
    except ValueError:
        if args.hour is not None:
            raise
        snapshot = fetch_snapshot(args.realm, hour - 3600)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"GGG request failed: HTTP {error.code}; retry after {error.headers.get('Retry-After', 'the next hourly boundary')}") from error
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(snapshot, separators=(",", ":")))
    os.replace(temporary, args.output)
    print(f"saved {len(snapshot['markets'])} markets for hour {snapshot['hour']}")


if __name__ == "__main__":
    main()
