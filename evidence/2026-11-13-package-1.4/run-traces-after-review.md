== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B8: six calls at once through two gateway processes, against room for one: exactly one forwarded, five refused, judged one after another under the project's row lock | project f14_4a93e651 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 358 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 359 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 360 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 361 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 362 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 363 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B8: six calls at once through two gateway processes, against room for one: exactly one forwarded, five refused, judged one after another under the project's row lock | project f14_4a93e651 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 358 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 359 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 360 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 361 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 362 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 363 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 364 model.call | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 365 hold.settled | 0.006142 | 0.000000 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B9 (1): the gateway process killed while the provider has not answered: a gateway started afterwards finds the hold, keeps it at its full amount and marks it unreconciled; a running sibling's hold is left alone | project f14_7f84a118 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 368 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 369 hold.found_at_startup | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B9 (1): the gateway process killed while the provider has not answered: a gateway started afterwards finds the hold, keeps it at its full amount and marks it unreconciled; a running sibling's hold is left alone | project f14_6244e089 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 366 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 367 hold.found_at_startup | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 370 model.call | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 371 hold.settled | 0.006142 | 0.000000 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B9 (2): the gateway process killed mid-stream, after output began: the hold is kept at its full amount, unreconciled, by the gateway started afterwards | project f14_9c58ce92 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 372 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 373 hold.found_at_startup | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B9 (3): the gateway process killed while it waits to write the settle (a third session holds the project's lock): nothing is written for the call, and the hold is kept, unreconciled, by the gateway started afterwards | project f14_0fe01d1d ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 374 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 375 hold.found_at_startup | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (1): the database refuses the call's model.call write after the provider answered: the hold stays open, unreconciled; the project is frozen, the fault raised; its next call and its counting call are refused with the reason, nothing forwarded, also after a cap raise; another project is unaffected | project f14_ce6d1395 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.029900 | 0.000000 |
| after event 376 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 378 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 379 gateway.fault | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 380 project.frozen | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 381 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 382 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 383 cap.changed | 0.000000 | 0.009960 | 0.000000 | 10.000000 | 0.006142 |
| after event 384 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 10.000000 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (1): the database refuses the call's model.call write after the provider answered: the hold stays open, unreconciled; the project is frozen, the fault raised; its next call and its counting call are refused with the reason, nothing forwarded, also after a cap raise; another project is unaffected | project f14_c1741b06 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 385 hold.opened | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 386 model.call | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 387 hold.settled | 0.006142 | 0.000000 | 0.000000 | 5.000000 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (2): the freeze itself cannot be written either: the gateway's gate stays closed and it forwards nothing for any project, writing nothing, until the freeze is written; then the project is frozen and the other resumes | project f14_cb59a162 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.029900 | 0.000000 |
| after event 388 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 390 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 391 gateway.fault | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 392 project.frozen | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 396 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (2): the freeze itself cannot be written either: the gateway's gate stays closed and it forwards nothing for any project, writing nothing, until the freeze is written; then the project is frozen and the other resumes | project f14_021b3120 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 393 hold.opened | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 394 model.call | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 395 hold.settled | 0.006142 | 0.000000 | 0.000000 | 5.000000 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (3): every write refused, then the gateway process killed: the journal line survives, and the gateway started afterwards writes it before it serves, so the project's first call is refused as frozen | project f14_94f8cd43 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.029900 | 0.000000 |
| after event 399 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 401 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 402 gateway.fault | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 403 project.frozen | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 404 hold.found_at_startup | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 405 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (3): every write refused, then the gateway process killed: the journal line survives, and the gateway started afterwards writes it before it serves, so the project's first call is refused as frozen | project f14_0f762c56 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 406 hold.opened | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 407 model.call | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 408 hold.settled | 0.006142 | 0.000000 | 0.000000 | 5.000000 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (7): the journal file cannot be written either: the gate stays closed, with the record kept in memory, until the database takes it | project f14_79af28ed ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.029900 | 0.000000 |
| after event 409 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 411 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 412 gateway.fault | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 413 project.frozen | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 417 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (7): the journal file cannot be written either: the gate stays closed, with the record kept in memory, until the database takes it | project f14_0b839593 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 414 hold.opened | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 415 model.call | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 416 hold.settled | 0.006142 | 0.000000 | 0.000000 | 5.000000 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (8): a call that passed the gate before it closed, and waits at its counting call, is not forwarded once the gate is closed: its hold is given back (only the counting call was sent) and it gets the 503 | project f14_21105f73 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.029900 | 0.000000 |
| after event 418 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 420 hold.opened | 0.000000 | 0.019920 | 0.000000 | 0.029900 | 0.006142 |
| after event 421 hold.settled | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 422 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 423 gateway.fault | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 424 project.frozen | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (4): under the project's lock, a frozen project opens no hold, starts no step, and a running step's calls are refused, whatever the cap | project f14_7f5928f7 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 425 step.hold_opened | 0.000000 | 0.000000 | 0.019920 | 5.000000 | 0.000000 |
| after event 426 hold.opened | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 427 hold.kept | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 428 gateway.fault | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 429 project.frozen | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 430 gateway.refused | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 431 gateway.refused | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 432 step.refused | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B11 (1): a stream cut after output began keeps its full hold, open and unreconciled; the usage seen is recorded for information only, and nothing is released | project f14_5e334b79 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 444 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 445 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B11 (2): a call that gets no answer at all (the provider read it and closed the connection) keeps its full hold, open and unreconciled | project f14_9092eb3d ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 446 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 447 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B12: a successful answer that cannot be read (no usage block; a body that is not JSON) keeps its full hold, open, and the call marked unreconciled | project f14_6a9b3e3b ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 448 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 449 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B12: a successful answer that cannot be read (no usage block; a body that is not JSON) keeps its full hold, open, and the call marked unreconciled | project f14_57abb473 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 450 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 451 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > 1.4: a call that passed the liveness check, and waits at its counting call, is not forwarded once the gateway has lost its lock: its hold is given back and it gets the 503 | project f14_89cc83f8 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 459 hold.opened | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.000000 |
| after event 460 hold.settled | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |

