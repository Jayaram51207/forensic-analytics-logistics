"""Isolation Forest baseline on behavioural features, compared with the rules.

    python evaluation/ml_baseline.py --train datasets/train-101 --test datasets/seed-1 datasets/seed-2 datasets/seed-3

Unit of analysis: one job lifecycle (one row of features.csv, written by evaluate.js).
No label, identifier or rule output is a model input.

Two protocols:
  normal-only (default)  fit on jobs known to be normal; threshold = (1 - q) quantile of
                         the training scores, i.e. about q of normal jobs are flagged.
  --unsupervised         fit on an unlabelled mixed dataset, as Isolation Forest is normally
                         used; threshold = (1 - q) quantile of that dataset's scores, i.e.
                         the q most isolated jobs are flagged. Labels of the fitting set
                         are never read. Test sets must be different seeds.
q is --quantile. The threshold is fixed before any test data is seen. `contamination`
stays 'auto' because the decision threshold comes from the quantile.
Results go to evaluation/results/<--name>.json. Every number there comes from this run.
"""
import argparse
import csv
import json
import os
import statistics
import sys

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

NON_FEATURES = {'rule_flag', 'full_flag', 'rule_priority', 'job_no'}  # plus every LABEL_* column


def load(path):
    with open(os.path.join(path, 'features.csv'), newline='') as fh:
        rows = list(csv.DictReader(fh))
    cols = [c for c in rows[0] if c not in NON_FEATURES and not c.startswith('LABEL_')]
    X = np.array([[float(r[c]) for c in cols] for r in rows])
    return rows, cols, X


def metrics(y, pred):
    tp = int(((y == 1) & (pred == 1)).sum()); fp = int(((y == 0) & (pred == 1)).sum())
    fn = int(((y == 1) & (pred == 0)).sum()); tn = int(((y == 0) & (pred == 0)).sum())
    p = tp / (tp + fp) if tp + fp else None
    r = tp / (tp + fn) if tp + fn else None
    f1 = 2 * p * r / (p + r) if p and r else (0.0 if p is not None and r is not None else None)
    return {'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn, 'precision': p, 'recall': r, 'f1': f1,
            'false_positive_rate': fp / (fp + tn) if fp + tn else None}


def summarise(runs):
    out = {}
    for k in ('precision', 'recall', 'f1', 'false_positive_rate'):
        vals = [r[k] for r in runs if r[k] is not None]
        out[k] = {'mean': statistics.mean(vals) if vals else None, 'sd': statistics.pstdev(vals) if len(vals) > 1 else 0.0, 'n': len(vals)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--train', required=True)
    ap.add_argument('--test', nargs='+', required=True)
    ap.add_argument('--quantile', type=float, default=0.05)
    ap.add_argument('--unsupervised', action='store_true')
    ap.add_argument('--name', default='ml')
    ap.add_argument('--model-seeds', type=int, nargs='+', default=[0, 1, 2, 3, 4])
    args = ap.parse_args()

    train_rows, cols, Xtr = load(args.train)
    if not args.unsupervised:
        assert all(r['LABEL_anomalous'] == '0' for r in train_rows), 'training set must be normal-only (or pass --unsupervised)'
    assert os.path.abspath(args.train) not in [os.path.abspath(t) for t in args.test], 'fit and test sets must differ'
    scaler = StandardScaler().fit(Xtr)
    result = {'features': cols, 'train': {'dataset': os.path.basename(args.train), 'rows': len(train_rows)},
              'protocol': 'unsupervised_mixed_fit' if args.unsupervised else 'normal_only_fit', 'quantile': args.quantile,
              'constant_features_in_fit_set': [c for i, c in enumerate(cols) if Xtr[:, i].std() == 0],
              'model_seeds': args.model_seeds, 'tests': []}

    for path in args.test:
        rows, cols2, X = load(path)
        assert cols2 == cols
        y = np.array([int(r['LABEL_anomalous']) for r in rows])
        rule = np.array([int(r['rule_flag']) for r in rows])   # variant A: rules only
        full = np.array([int(r['full_flag']) for r in rows])   # variant D: rules + contradiction analysis
        types = sorted({r['LABEL_type'] for r in rows})
        per_seed = {'ml_only': [], 'hybrid_rules_or_ml': [], 'full_or_ml': []}
        ml_votes = np.zeros(len(rows))
        for seed in args.model_seeds:
            model = IsolationForest(n_estimators=200, contamination='auto', random_state=seed).fit(scaler.transform(Xtr))
            threshold = np.quantile(-model.score_samples(scaler.transform(Xtr)), 1 - args.quantile)
            ml = (-model.score_samples(scaler.transform(X)) > threshold).astype(int)
            ml_votes += ml
            per_seed['ml_only'].append(metrics(y, ml))
            per_seed['hybrid_rules_or_ml'].append(metrics(y, np.maximum(ml, rule)))
            per_seed['full_or_ml'].append(metrics(y, np.maximum(ml, full)))
        by_type = {}
        for t in types:
            idx = np.array([r['LABEL_type'] == t for r in rows])
            by_type[t] = {'class': next(r['LABEL_class'] for r in rows if r['LABEL_type'] == t), 'n': int(idx.sum()),
                          'rules_flag_rate': float(rule[idx].mean()), 'full_flag_rate': float(full[idx].mean()), 'ml_flag_rate_mean_over_seeds': float(ml_votes[idx].mean() / len(args.model_seeds))}
        result['tests'].append({
            'dataset': os.path.basename(path), 'rows': len(rows), 'positives': int(y.sum()),
            'rules_only': metrics(y, rule),
            'full_framework': metrics(y, full),
            'full_or_ml': {'per_seed': per_seed['full_or_ml'], 'summary': summarise(per_seed['full_or_ml'])},
            'ml_only': {'per_seed': per_seed['ml_only'], 'summary': summarise(per_seed['ml_only'])},
            'hybrid_rules_or_ml': {'per_seed': per_seed['hybrid_rules_or_ml'], 'summary': summarise(per_seed['hybrid_rules_or_ml'])},
            'by_type': by_type})

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results', args.name + '.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as fh:
        json.dump(result, fh, indent=1)

    fmt = lambda v: 'n/a' if v is None else f'{v:.3f}'
    print(f"protocol={result['protocol']} q={args.quantile} fit={result['train']['dataset']} constant features in fit set: {result['constant_features_in_fit_set']}")
    for t in result['tests']:
        r = t['rules_only']
        print(f"{t['dataset']}  n={t['rows']} positives={t['positives']}")
        print(f"  A rules            P {fmt(r['precision'])} R {fmt(r['recall'])} F1 {fmt(r['f1'])} FPR {fmt(r['false_positive_rate'])}")
        d = t['full_framework']
        print(f"  D full framework   P {fmt(d['precision'])} R {fmt(d['recall'])} F1 {fmt(d['f1'])} FPR {fmt(d['false_positive_rate'])}")
        for name in ('ml_only', 'hybrid_rules_or_ml', 'full_or_ml'):
            s = t[name]['summary']
            print(f"  {name:<18} P {fmt(s['precision']['mean'])}+/-{fmt(s['precision']['sd'])} R {fmt(s['recall']['mean'])}+/-{fmt(s['recall']['sd'])} "
                  f"F1 {fmt(s['f1']['mean'])}+/-{fmt(s['f1']['sd'])} FPR {fmt(s['false_positive_rate']['mean'])}+/-{fmt(s['false_positive_rate']['sd'])}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
