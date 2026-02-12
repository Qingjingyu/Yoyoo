# Yoyoo Employee Bootstrap

This folder defines Yoyoo 1.0.1 employee activation baseline.

## Goal
Any new employee activated from Git should get the same default stack:
- OpenClaw
- MiniMax provider config
- QMD backend
- base skills
- role profile
- gateway health baseline
- Yoyoo backend long-task kernel (retry + resume)

## Quick Start
On server (root):

```bash
git clone -b release/yoyoo-1.0-rc1 git@github.com:Qingjingyu/Yoyoo.git
cd Yoyoo
export MINIMAX_API_KEY='your_key'
export YOYOO_ROLE='ceo'   # ceo | ops | rd-director | rd-engineer
bash Yoyoo/project/bootstrap/activate_employee.sh
```

Optional:
- `YOYOO_FORCE_OPENCLAW_INSTALL=1` to force reinstall OpenClaw latest.
- `YOYOO_ENABLE_BACKEND_KERNEL=0` to skip backend kernel install (not recommended).

## Hire directly from Git

```bash
export MINIMAX_API_KEY='your_key'
export YOYOO_ROLE='ceo'
bash Yoyoo/project/bootstrap/hire_employee_from_git.sh
```

## Files
- `activate_employee.sh`: one-step activation.
- `qmd_enable.sh`: enable QMD memory backend.
- `install_base_skills.sh`: install default skills.
- `setup_guard.sh`: install 2-minute healthcheck + auto-restart timer.
- `hire_employee_from_git.sh`: pull repo and activate employee.
- `profiles/*`: role identity/soul/memory/contract templates.
- `registry/capability-catalog.yaml`: baseline/optional capability governance.
