class Diagnostics:
    def __init__(self):
        self.items = []

    def report(self, code, message, path=None, node=None, severity="warning"):
        item = {"code": "python." + code, "severity": severity, "message": message}
        if path:
            item["source"] = {"path": path}
            if node is not None:
                item["source"].update(line=node.lineno, column=node.col_offset + 1)
        self.items.append(item)
