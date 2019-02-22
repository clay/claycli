workflow "Test ghpages" {
  on = "push"
  resolves = ["Deploy to GitHub Pages"]
}
action "Build QA" {
  uses = "actions/bin/filter@master"
  args = "branch master"
}

action "Deploy to GitHub Pages" {
  needs = ["Build QA"]
  uses = "./"
  env = {
    BUILD_DIR = "website"
  }
  secrets = ["GH_PAT"]
}
