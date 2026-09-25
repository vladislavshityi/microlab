//! Решение плотной линейной системы методом Гаусса с частичным выбором ведущего элемента.
//! Размер системы — число узлов с неизвестным потенциалом (десятки–сотни), поэтому плотная матрица
//! достаточна. Порядок операций фиксирован, результат детерминирован.

/// Решает `a · x = b`. `a` — матрица n×n по строкам. Возвращает `None` для вырожденной системы.
pub fn solve(mut a: Vec<f64>, mut b: Vec<f64>) -> Option<Vec<f64>> {
    let n = b.len();
    debug_assert_eq!(a.len(), n * n);
    // Порог вырожденности относительно наибольшего элемента матрицы.
    let scale = a.iter().fold(0.0f64, |m, v| m.max(v.abs()));
    let eps = scale * 1e-14;
    for col in 0..n {
        let mut piv = col;
        for row in col + 1..n {
            if a[row * n + col].abs() > a[piv * n + col].abs() {
                piv = row;
            }
        }
        if a[piv * n + col].abs() <= eps {
            return None;
        }
        if piv != col {
            for k in 0..n {
                a.swap(col * n + k, piv * n + k);
            }
            b.swap(col, piv);
        }
        let d = a[col * n + col];
        for row in col + 1..n {
            let f = a[row * n + col] / d;
            if f == 0.0 {
                continue;
            }
            for k in col..n {
                a[row * n + k] -= f * a[col * n + k];
            }
            b[row] -= f * b[col];
        }
    }
    let mut x = vec![0.0; n];
    for row in (0..n).rev() {
        let mut s = b[row];
        for k in row + 1..n {
            s -= a[row * n + k] * x[k];
        }
        x[row] = s / a[row * n + row];
    }
    Some(x)
}

#[cfg(test)]
mod tests {
    #[test]
    fn solves_small_system() {
        let x = super::solve(vec![2.0, 1.0, 1.0, 3.0], vec![3.0, 5.0]).unwrap();
        assert!((x[0] - 0.8).abs() < 1e-12 && (x[1] - 1.4).abs() < 1e-12);
    }

    #[test]
    fn detects_singular() {
        assert!(super::solve(vec![1.0, 1.0, 1.0, 1.0], vec![1.0, 2.0]).is_none());
    }
}
