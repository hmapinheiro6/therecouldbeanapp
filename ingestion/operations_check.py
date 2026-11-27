"""Verify the deployed edge runtime; never print upstream bodies or credentials."""
import json
from .client import InternalClient

def verify(client=None):
    result=(client or InternalClient()).request('/api/internal/operations-check',{})
    budget=result.get('budget',{}) if isinstance(result,dict) else {}
    if not isinstance(result,dict) or not isinstance(budget,dict) or result.get('status')!='verified' or not isinstance(budget.get('allowed'),bool) or budget.get('reason')=='usage_unavailable':
        raise ValueError('Deployed operations verification did not complete')
    print(json.dumps({'edge_operations':'verified','bulk_allowed':budget['allowed'],'budget_reason':budget.get('reason')}))
    return result

if __name__=='__main__':verify()
