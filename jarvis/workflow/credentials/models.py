"""Credential metadata models; secret values are never serialized in workflows."""
from dataclasses import dataclass
@dataclass(frozen=True)
class CredentialReference:
    id:str; provider:str; display_name:str
