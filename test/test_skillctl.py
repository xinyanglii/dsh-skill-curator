"""Tests for the vendored skillctl CLI and reviewer prompt builder."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "skillctl"


class SkillctlTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="skillctl-test-")
        base = pathlib.Path(self.tmp.name)
        self.root = base / "skills"
        self.sessions = base / "sessions"
        self.root.mkdir()
        self.sessions.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *args, stdin=None, extra_env=None):
        env = os.environ.copy()
        env["DSH_SKILLS_ROOT"] = str(self.root)
        env["DSH_SESSIONS"] = str(self.sessions)
        if extra_env:
            env.update(extra_env)
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            input=stdin,
            capture_output=True,
            text=True,
            env=env,
            timeout=60,
        )

    def create_demo(self):
        result = self.run_cli(
            "manage",
            "create",
            "demo",
            "--description=Demo skill",
            "--created-by=agent",
            "--actor=agent",
            "--file=-",
            stdin="## When to Use\n\nUse it.\n\n## Verification\n\nCheck it.\n",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return self.root / "demo" / "SKILL.md"

    def test_create_generates_frontmatter_and_body(self):
        skill = self.create_demo()
        text = skill.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\n"))
        self.assertIn("name: demo", text)
        self.assertIn('description: "Demo skill"', text)
        self.assertIn("## When to Use", text)

    def test_invalid_names_are_rejected(self):
        result = self.run_cli(
            "manage",
            "create",
            "../escape",
            "--description=x",
            "--created-by=agent",
            "--actor=agent",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid name", result.stderr)
        self.assertFalse((self.root.parent / "escape").exists())

    def test_patch_requires_the_current_sha(self):
        skill = self.create_demo()
        current = hashlib.sha256(skill.read_text(encoding="utf-8").encode()).hexdigest()

        stale = self.run_cli(
            "manage",
            "patch",
            "demo",
            "--old=Use it.",
            "--new=Use it carefully.",
            "--expect-sha=" + "0" * 64,
            "--actor=agent",
        )
        self.assertNotEqual(stale.returncode, 0)
        self.assertIn("read-before-write failed", stale.stderr.lower())

        ok = self.run_cli(
            "manage",
            "patch",
            "demo",
            "--old=Use it.",
            "--new=Use it carefully.",
            "--expect-sha=" + current,
            "--actor=agent",
        )
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertIn("Use it carefully.", skill.read_text(encoding="utf-8"))

    def test_write_file_is_confined_to_support_directories(self):
        self.create_demo()
        ok = self.run_cli(
            "manage",
            "write_file",
            "demo",
            "--path=references/notes.md",
            "--file=-",
            "--actor=agent",
            stdin="notes\n",
        )
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertEqual((self.root / "demo" / "references" / "notes.md").read_text(), "notes\n")

        bad = self.run_cli(
            "manage",
            "write_file",
            "demo",
            "--path=../escape.md",
            "--file=-",
            "--actor=agent",
            stdin="nope\n",
        )
        self.assertNotEqual(bad.returncode, 0)
        self.assertFalse((self.root / "escape.md").exists())

    def test_archive_and_restore_round_trip(self):
        self.create_demo()
        archived = self.run_cli("manage", "archive", "demo", "--actor=agent")
        self.assertEqual(archived.returncode, 0, archived.stderr)
        self.assertTrue((self.root / ".archive" / "demo" / "SKILL.md").exists())
        self.assertFalse((self.root / "demo").exists())

        restored = self.run_cli("restore", "demo")
        self.assertEqual(restored.returncode, 0, restored.stderr)
        self.assertTrue((self.root / "demo" / "SKILL.md").exists())

    def test_create_rejects_an_oversized_body(self):
        result = self.run_cli(
            "manage",
            "create",
            "huge",
            "--description=Huge skill",
            "--created-by=agent",
            "--actor=agent",
            "--file=-",
            stdin="x" * 100_001,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("(limit: 100,000)", result.stderr)
        self.assertFalse((self.root / "huge").exists())

    def test_patch_rejects_a_result_above_the_limit(self):
        skill = self.create_demo()
        before = skill.read_text(encoding="utf-8")
        current = hashlib.sha256(before.encode()).hexdigest()
        result = self.run_cli(
            "manage",
            "patch",
            "demo",
            "--old=Use it.",
            "--new=" + "y" * 100_001,
            "--expect-sha=" + current,
            "--actor=agent",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("(limit: 100,000)", result.stderr)
        self.assertEqual(skill.read_text(encoding="utf-8"), before)

    def test_write_file_rejects_a_file_above_one_mib(self):
        self.create_demo()
        result = self.run_cli(
            "manage",
            "write_file",
            "demo",
            "--path=references/big.md",
            "--file=-",
            "--actor=agent",
            stdin="z" * (1_048_577),
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("limit", result.stderr)
        self.assertFalse((self.root / "demo" / "references" / "big.md").exists())

    def make_skill(self, name, created_by="agent"):
        result = self.run_cli(
            "manage", "create", name,
            "--description=%s skill" % name,
            "--created-by=" + created_by,
            "--actor=agent",
            "--file=-",
            stdin="## When to Use\n\nUse it.\n\n## Verification\n\nCheck it.\n",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_consolidation_prompt_lists_only_curator_managed_candidates(self):
        self.make_skill("agent-skill")
        self.make_skill("manual-skill", created_by="manual")
        result = self.run_cli("consolidate")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("agent-skill", result.stdout)
        self.assertNotIn("manual-skill", result.stdout)
        self.assertIn("absorbed_into", result.stdout)
        self.assertIn("consolidations:", result.stdout)
        self.assertIn("Nothing to consolidate", result.stdout)

    def test_consolidation_prompt_skips_pinned_skills(self):
        self.make_skill("agent-skill")
        self.assertEqual(self.run_cli("pin", "agent-skill").returncode, 0)
        result = self.run_cli("consolidate")
        self.assertIn("No curator-managed skills", result.stdout)

    def test_archive_with_absorbed_into_records_the_umbrella(self):
        self.make_skill("umbrella")
        self.make_skill("sibling")
        result = self.run_cli("manage", "archive", "sibling", "--absorbed-into=umbrella", "--actor=agent")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("absorbed into umbrella", result.stdout)
        self.assertFalse((self.root / "sibling").exists())
        self.assertTrue((self.root / "umbrella").exists())
        ledger = [json.loads(line) for line in (self.root / ".curator_ledger.jsonl").read_text().splitlines() if line.strip()]
        archive = [entry for entry in ledger if entry.get("op") == "archive"][-1]
        self.assertEqual(archive.get("absorbed_into"), "umbrella")
        usage = json.loads((self.root / ".dsh-usage.json").read_text())
        self.assertEqual(usage["skills"]["sibling"].get("absorbed_into"), "umbrella")

    def test_consolidation_mode_requires_absorbed_into(self):
        self.make_skill("sibling")
        result = self.run_cli(
            "manage", "archive", "sibling", "--actor=agent",
            extra_env={"DSH_CURATOR_CONSOLIDATION": "1"},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("absorbed-into", result.stderr)
        self.assertTrue((self.root / "sibling").exists())

    def test_consolidation_mode_refuses_user_owned_skills(self):
        self.make_skill("manual-skill", created_by="manual")
        result = self.run_cli(
            "manage", "patch", "manual-skill", "--old=Use it.", "--new=Use it now.",
            "--expect-sha=" + hashlib.sha256((self.root / "manual-skill" / "SKILL.md").read_bytes()).hexdigest(),
            "--actor=agent",
            extra_env={"DSH_CURATOR_CONSOLIDATION": "1"},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not curator-managed", result.stderr)

    def test_consolidation_mode_refuses_absorbing_into_a_user_owned_skill(self):
        self.make_skill("manual-umbrella", created_by="manual")
        self.make_skill("agent-sibling")
        result = self.run_cli(
            "manage", "archive", "agent-sibling", "--absorbed-into=manual-umbrella", "--actor=agent",
            extra_env={"DSH_CURATOR_CONSOLIDATION": "1"},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not curator-managed", result.stderr)
        self.assertTrue((self.root / "agent-sibling").exists())

    def test_consolidation_mode_refuses_pinned_skills(self):
        self.make_skill("pinned-skill")
        self.assertEqual(self.run_cli("pin", "pinned-skill").returncode, 0)
        result = self.run_cli(
            "manage", "archive", "pinned-skill", "--absorbed-into=umbrella", "--actor=agent",
            extra_env={"DSH_CURATOR_CONSOLIDATION": "1"},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pinned", result.stderr)

    def test_request_consolidation_writes_a_marker(self):
        result = self.run_cli("curator", "--request-consolidation")
        self.assertEqual(result.returncode, 0, result.stderr)
        marker = self.root / ".dsh-curator" / "consolidate.request"
        self.assertTrue(marker.exists())
        self.assertIn("requested_at", marker.read_text())

    def test_list_json_reports_library_metadata(self):
        self.make_skill("agent-skill")
        result = self.run_cli("list", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = json.loads(result.stdout)
        row = next(item for item in rows if item["name"] == "agent-skill")
        self.assertEqual(row["created_by"], "agent")
        self.assertEqual(row["state"], "active")
        self.assertGreater(row["bytes"], 0)
        self.assertIn("description", row)

    def test_review_prompt_tags_each_skill_with_its_origin(self):
        self.make_skill("agent-skill")
        self.make_skill("manual-skill", created_by="manual")
        result = self.run_cli("review")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("- [agent] agent-skill:", result.stdout)
        self.assertIn("- [manual] manual-skill:", result.stdout)
        self.assertIn("READ-ONLY", result.stdout)
        self.assertIn("do NOT create a parallel", result.stdout)
        self.assertIn("Nothing to save.", result.stdout)

    def test_reviewer_cannot_modify_a_user_owned_skill(self):
        self.make_skill("manual-skill", created_by="manual")
        sha = hashlib.sha256((self.root / "manual-skill" / "SKILL.md").read_bytes()).hexdigest()
        patch = self.run_cli(
            "manage", "patch", "manual-skill", "--old=Use it.", "--new=Use it now.",
            "--expect-sha=" + sha, "--actor=agent",
        )
        self.assertNotEqual(patch.returncode, 0)
        self.assertIn("user-owned", patch.stderr)
        archive = self.run_cli("manage", "archive", "manual-skill", "--actor=agent")
        self.assertNotEqual(archive.returncode, 0)
        self.assertIn("user-owned", archive.stderr)
        self.assertTrue((self.root / "manual-skill").exists())

    def test_reviewer_can_still_patch_agent_owned_skills(self):
        self.make_skill("agent-skill")
        sha = hashlib.sha256((self.root / "agent-skill" / "SKILL.md").read_bytes()).hexdigest()
        result = self.run_cli(
            "manage", "patch", "agent-skill", "--old=Use it.", "--new=Use it now.",
            "--expect-sha=" + sha, "--actor=agent",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_validate_accepts_a_generated_skill(self):
        self.create_demo()
        result = self.run_cli("validate", "demo")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ok", result.stdout)

    def test_review_prompt_is_self_contained(self):
        from importlib.machinery import SourceFileLoader

        loader = SourceFileLoader("skillctl", str(SCRIPT))
        spec = importlib.util.spec_from_loader("skillctl", loader)
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        prompt = module.review_prompt("user: hello\nassistant: hi", ["- [agent] demo: Demo skill"])
        self.assertIn("background skill REVIEWER", prompt)
        self.assertIn("user: hello", prompt)
        self.assertIn("- [agent] demo: Demo skill", prompt)
        self.assertIn("USER-OWNED", prompt)
        self.assertIn("Nothing to save.", prompt)
        self.assertIn("skill_manage", prompt)

    def test_vendored_script_has_no_machine_specific_content(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("#!/usr/bin/env python3"))
        for forbidden in ("/Users/", "/opt/homebrew", "opencode-go", "commandcode", "NOTION_MCP_TOKEN"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
