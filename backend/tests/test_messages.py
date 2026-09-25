"""
Every message a person can be shown has Arabic wording.

The error text lives at the place it is raised, in English, and is translated
on the way out (app/core/messages.py). Nothing stops someone adding a new
`HTTPException` without a translation, and the result would be an English
sentence in the middle of an Arabic screen -- which is exactly the bug this
suite was written for. So the check reads the routers themselves: every
message the code can raise must have an entry.

Run:  docker compose exec backend python -m tests.test_messages
"""

import ast
import pathlib
import sys

from app.core import messages

APP = pathlib.Path(__file__).resolve().parent.parent / "app"
failures: list[str] = []


def check(name: str, cond: bool, info: object = "") -> None:
    if cond:
        print(f"   OK  {name}")
    else:
        failures.append(f"{name}: {info}")
        print(f"   FAIL {name}: {info}")


# Two messages are assembled from parts at runtime, so a generic sample slot
# ("5") would not produce a sentence the server ever actually sends. These are
# the real renderings, listed by the start of their template.
SAMPLES: dict[str, list[str]] = {
    "Password must contain": [
        "Password must contain at least 10 characters.",
        "Password must contain both letters and numbers.",
        "Password must contain at least 10 characters and both letters and numbers.",
    ],
    "The writing model could not be": [
        "The writing model could not be loaded: not enough memory",
        "The writing model could not be unloaded: the model server did not answer",
    ],
}


def raised_messages() -> dict[str, str]:
    """Every literal HTTPException message in the app, with where it is raised.

    f-strings are rebuilt with a sample value in each slot so they can be run
    through the same translation the server does."""
    found: dict[str, str] = {}
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and getattr(node.func, "id", "") == "HTTPException"):
                continue
            details = list(node.args[1:2]) + [k.value for k in node.keywords if k.arg == "detail"]
            for arg in details:
                where = f"{path.relative_to(APP.parent)}:{arg.lineno}"
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    found[arg.value] = where
                elif isinstance(arg, ast.JoinedStr):
                    sample = "".join(v.value if isinstance(v, ast.Constant) else "5" for v in arg.values)
                    real = next((v for k, v in SAMPLES.items() if sample.startswith(k)), None)
                    for text in real or [sample]:
                        found[text] = where
    return found


print("Messages raised by the API")
raised = raised_messages()
check("the routers were read", len(raised) > 40, f"only {len(raised)} messages found")

untranslated = {m: w for m, w in raised.items() if messages.translate(m, "ar") == m}
check("every raised message has Arabic wording", not untranslated,
      "\n        " + "\n        ".join(f"{w}  {m}" for m, w in sorted(untranslated.items(), key=lambda kv: kv[1])))

print("Translation behaviour")
check("English is left alone", messages.translate("Case not found.", "en") == "Case not found.")
check("an unknown message passes through rather than vanishing",
      messages.translate("Something nobody translated.", "ar") == "Something nobody translated.")
check("a non-string detail passes through", messages.translate({"code": 1}, "ar") == {"code": 1})
check("values are carried into the Arabic sentence",
      "15" in str(messages.translate("File is larger than the 15 MB limit.", "ar")))
check("the name keeps its place in the Arabic sentence",
      str(messages.translate("Fatima Al Hosani is still at the stand. Step them down first.", "ar"))
      .startswith("Fatima Al Hosani"))
check("a specific message wins over the catch-all '<x> not found'",
      messages.translate("User not found.", "ar") == messages.ARABIC["User not found."])

print("Language negotiation")
for header, want in [("ar", "ar"), ("ar-AE,ar;q=0.9", "ar"), ("en-GB,en;q=0.9", "en"), (None, "en"), ("", "en"),
                     ("fr-FR", "en")]:
    check(f"Accept-Language {header!r} -> {want}", messages.language_of(header) == want)

if failures:
    print(f"\n{len(failures)} CHECK(S) FAILED")
    sys.exit(1)
print("\nMESSAGE CHECKS PASSED")
