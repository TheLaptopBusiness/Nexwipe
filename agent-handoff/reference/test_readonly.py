"""Safety tests for the read-only reference client: destructive invocations are refused."""
import importlib.util, pathlib, unittest

spec = importlib.util.spec_from_file_location("nd", pathlib.Path(__file__).with_name("nd_agent_readonly.py"))
nd = importlib.util.module_from_spec(spec); spec.loader.exec_module(nd)

class ReadOnly(unittest.TestCase):
    def test_refuses_destructive_commands(self):
        for argv in (["nvme", "sanitize", "/dev/nvme0", "-a", "4"], ["nvme", "format", "/dev/nvme0n1", "-s", "2"],
                     ["hdparm", "--security-erase", "p", "/dev/sda"], ["dd", "if=/dev/zero", "of=/dev/sda"],
                     ["blkdiscard", "/dev/sda"], ["sg_sanitize", "/dev/sg0"], ["nvme", "sanitize-log", "/dev/nvme0"]):
            with self.assertRaises(RuntimeError, msg=argv):
                nd.run_ro(argv)

    def test_allows_identity_reads(self):
        nd.run_ro(["lsblk", "-J", "-b", "-d", "-o", "NAME"])  # must not raise

    def test_source_contains_no_destructive_calls(self):
        src = pathlib.Path(nd.__file__).read_text()
        code = src.split("READ_ONLY_COMMANDS = {", 1)[1]
        for bad in ('"sanitize"', '"format"', "--security-erase", "blkdiscard", '"dd"', "sg_sanitize", "O_WRONLY | os.O_DIRECT"):
            self.assertNotIn(bad, code.split("def run_ro")[1] if bad != "x" else code)

if __name__ == "__main__":
    unittest.main()
