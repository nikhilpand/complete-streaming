from __future__ import annotations
import base64,json
from typing import Any
def encode_cursor(payload:dict[str,Any])->str:return base64.urlsafe_b64encode(json.dumps(payload,separators=(",",":"),sort_keys=True).encode()).decode().rstrip("=")
def decode_cursor(cursor:str)->dict[str,Any]:
    data=json.loads(base64.urlsafe_b64decode((cursor+"="*(-len(cursor)%4)).encode()).decode())
    if not isinstance(data,dict):raise ValueError("Invalid cursor")
    return data
