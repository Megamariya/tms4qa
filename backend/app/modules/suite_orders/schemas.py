from pydantic import BaseModel
from typing import Dict, List


class SuiteOrderData(BaseModel):
    root: List[str] = []
    children: Dict[str, List[str]] = {}
