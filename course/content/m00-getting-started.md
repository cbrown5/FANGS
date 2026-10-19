# Getting started 

Bayesian statistics are some of the most useful inferential tools we have. They can deal with all of the messy problems we have in real world data and they offer an alternative philosophy to the more frequently taught frequentist methods. Bayesian probability theory is also much more intuitive than frequentist theory. 

But learning the statistical computing methods that enable Bayesian inference can be difficult. There is a steep learning curve. A reasonable proficiency with coding is required for use of the best packages. 

Overcoming this challenge was why I developed FANGS the Fast Accessible Numeric Gibbs Sampler. 

FANGS runs in your web browser. Students can get started with Bayesian computation in a flash. I built it because I wanted to give my students a taster of Bayesian stats, but I didn't want them to waste the whole practical lesson trying to install software on their computers. 

Its relatively fast for small problems, both in terms of time to install it (just open the webpage) and time taken to compute the statistics. I tested it against leading R based Bayesian engines and its faster for small datasets. Perfect for teaching. 

FANGS is not a full Bayesian engine however. I don't recommend you use it for real science. Its slow for larger datasets and doesn't have all the features of a real Bayesian software. It hasn't been extensively tested by 100s of researchers like the best R packages have (Stan, brms, NIMBLE, JAGS to name a few). 

Use it as a gateway to learning Bayesian concepts, model syntax and Bayesian workflows. I hope it then helps you decide to then invest time in learning one of the R based packages. 

I leaned heavily on Claude Code to build FANGS. In fact, I don't know how to write Java Script (the language its written in). Claude wrote all the code, I reviewed exactly none of the Java Script. What I did do was extensive testing of FANGS against the same models and data written with R-NIMBLE. I think pretty much all scientific software will be written this way soon, FANGS is my early test of that process. 

The testing is how I'm confident it works and is accurate enough for teaching. 

A technical paper on how I built FANGS and the tests is forthcoming. 

Let's get started on the course. 

