import warnings


class LabelManager:
    """
    A unified interface to handle all label representations:
    - code
    - id (integer class index)
    - full name
    - hierarchy path
    - hierarchy prompt
    - prompt ("an image of + full name)
    """

    def __init__(self, label_codes, full_name_dict, hierarchy_dict):
        """
        Args:
            label_codes (list[str]): Ordered list of label codes.
            full_name_dict (dict): code -> full name mapping.
            hierarchy_dict (dict): child_code -> parent_code mapping.
        """
        self.label_codes = label_codes
        self.full_name_dict = full_name_dict
        self.hierarchy_dict = hierarchy_dict

        # Build mapping code <-> id
        self.code_to_id = {c: i for i, c in enumerate(label_codes)}
        self.id_to_code = {i: c for i, c in enumerate(label_codes)}

        self.full_name_to_code = {v: k for k, v in full_name_dict.items()}

    # ------------------------------
    # ✅ Basic conversions
    # ------------------------------

    def to_id(self, code):
        return self.code_to_id[code]

    def to_code(self, idx):
        return self.id_to_code[idx]

    def to_full_name(self, code):
        return self.full_name_dict.get(code, code)

    # ------------------------------
    # ✅ Hierarchy utilities
    # ------------------------------

    def to_hierarchy_path(self, code):
        """
        Returns a list representing the path from the root to the given code.
        Last element is replaced by full name if available.
        """
        path = [code]
        parent = self.hierarchy_dict.get(code, None)

        while parent is not None:
            path.append(parent)
            parent = self.hierarchy_dict.get(parent, None)

        path = path[::-1]

        # Replace final code with full name
        path[-1] = self.to_full_name(path[-1])
        return path

    def to_hierarchy_prompt(self, code, sep=" "):
        """
        Human-readable hierarchical text, ideal for CLIP prompts.
        """
        return sep.join(self.to_hierarchy_path(code))

    # ------------------------------
    # ✅ Batch utilities
    # ------------------------------

    def all_codes(self):
        return self.label_codes

    def all_ids(self):
        return list(self.code_to_id.values())

    def all_full_names(self):
        return [self.to_full_name(c) for c in self.label_codes]

    def all_hierarchy_prompts(self, sep=" "):
        return [self.to_hierarchy_prompt(c, sep) for c in self.label_codes]

    def get_out_features(self):
        return len(self.label_codes)

    # ------------------------------
    # ✅ Pretty printing
    # ------------------------------

    def summary(self, n=5):
        s = [f"Total labels: {len(self.label_codes)}", "Example:"]
        for code in self.label_codes[:n]:
            s.append(f"- {code}: {self.to_hierarchy_prompt(code)}")
            s.append(f"- {code}: {self.to_id(code)}")
            s.append(f"- {code}: {self.to_full_name(code)}")
        return "\n".join(s)

    def get_candidate_texts(self, encoding):
        if encoding == 'id': return self.all_ids()
        elif encoding == 'full_name': return self.all_full_names()
        elif encoding == 'hierarchy_prompt': return self.all_hierarchy_prompts()
        elif encoding == 'prompt' : return self.all_prompts()
        else:
            warnings.warn("No encoding specified, returning raw labels $all_codes$", UserWarning)
            return self.all_codes()

    def __str__(self):
        return self.summary()

        # ------------------------------
        # ✅ Prompt utilities
        # ------------------------------

    def to_prompt(self, code, template="an image of {}"):
        """
        Retourne un prompt textuel pour un code de label donné.
        Par défaut : "an image of + full name".
        """
        full_name = self.to_full_name(code)
        return template.format(full_name)

    def all_prompts(self, template="an image of {}"):
        """
        Retourne la liste des prompts pour tous les labels.
        """
        return [self.to_prompt(c, template) for c in self.label_codes]