#!/usr/bin/env python3
"""Builds the bundled Bible data for VerseBeam.

Inputs (download into one folder, pass it as the first argument):
  kjvfull.xml                  CrossWire KJV 1769 with Strong's numbers (public domain)
                               https://gitlab.com/crosswire-bible-society/kjv
  strongs-greek-dictionary.js  Open Scriptures Strong's dictionaries (CC-BY-SA)
  strongs-hebrew-dictionary.js https://github.com/openscriptures/strongs

Outputs: data/kjv.json and data/strongs.json next to this script's parent folder.

Verse markup written to kjv.json:
  {words|H430 H853}   words tagged with one or more Strong's numbers
  [words]             words added by the translators (printed in italics)
"""
import html, json, os, re, sys

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

BOOKS = ("Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov "
         "Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark "
         "Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet "
         "2Pet 1John 2John 3John Jude Rev").split()

xml = open(os.path.join(src, "kjvfull.xml"), encoding="utf-8").read()


def strong_ids(attrs):
    m = re.search(r'lemma="([^"]*)"', attrs)
    if not m:
        return ""
    ids = []
    for letter, num in re.findall(r"strong:([GH])0*(\d+)", m.group(1)):
        ids.append(letter + num)
    return " ".join(ids)


def word(m):
    ids, inner = strong_ids(m.group(1)), m.group(2)
    if not inner.strip():
        return ""
    return "{%s|%s}" % (inner, ids) if ids else inner


def convert(s):
    s = re.sub(r"<note\b.*?</note>", "", s, flags=re.S)
    s = re.sub(r"<title\b.*?</title>", "", s, flags=re.S)
    s = re.sub(r"<w\b[^>]*/>", "", s)
    s = re.sub(r"<divineName>(.*?)</divineName>", lambda m: m.group(1).upper(), s, flags=re.S)
    s = re.sub(r"<transChange\b[^>]*>(.*?)</transChange>", r"[\1]", s, flags=re.S)
    s = re.sub(r"<w\b([^>]*)>(.*?)</w>", word, s, flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s+([,.;:!?])", r"\1", s)
    return s


bible = [[] for _ in BOOKS]
count = 0
for osis, body in re.findall(r'<verse osisID="([^"]+)" sID="[^"]+"/>(.*?)<verse eID="\1"/>', xml, flags=re.S):
    book, chapter, verse = osis.split(".")
    b, c, v = BOOKS.index(book), int(chapter), int(verse)
    chapters = bible[b]
    while len(chapters) < c:
        chapters.append([])
    verses = chapters[c - 1]
    while len(verses) < v:
        verses.append("")
    verses[v - 1] = convert(body)
    count += 1

with open(os.path.join(out, "kjv.json"), "w", encoding="utf-8") as f:
    json.dump(bible, f, ensure_ascii=False, separators=(",", ":"))
print("verses:", count)


def lexicon(name):
    text = open(os.path.join(src, name), encoding="utf-8").read()
    start = text.index("{", text.index("var "))
    return json.loads(text[start:text.rindex("}") + 1])


entries = {}
for name in ("strongs-hebrew-dictionary.js", "strongs-greek-dictionary.js"):
    for key, e in lexicon(name).items():
        clean = lambda k: re.sub(r"\s+", " ", (e.get(k) or "")).strip().strip("{}")
        entries[key] = [clean("lemma"), clean("xlit") or clean("translit"), clean("pron"),
                        clean("strongs_def"), clean("kjv_def"), clean("derivation")]

with open(os.path.join(out, "strongs.json"), "w", encoding="utf-8") as f:
    json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))
print("lexicon entries:", len(entries))
