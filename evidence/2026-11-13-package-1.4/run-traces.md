== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B8: six calls at once through two gateway processes, against room for one: exactly one forwarded, five refused, judged one after another under the project's row lock | project f14_c35d9974 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 5413 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5414 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5415 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5416 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5417 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5418 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B8: six calls at once through two gateway processes, against room for one: exactly one forwarded, five refused, judged one after another under the project's row lock | project f14_c35d9974 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 5413 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5414 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5415 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5416 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5417 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5418 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5419 model.call | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5420 hold.settled | 0.006142 | 0.000000 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B9 (1): the gateway process killed while the provider has not answered: a gateway started afterwards finds the hold, keeps it at its full amount and marks it unreconciled; a running sibling's hold is left alone | project f14_0276917d ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 5423 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5424 hold.found_at_startup | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B9 (1): the gateway process killed while the provider has not answered: a gateway started afterwards finds the hold, keeps it at its full amount and marks it unreconciled; a running sibling's hold is left alone | project f14_39116c14 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 5421 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5422 hold.found_at_startup | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5425 model.call | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5426 hold.settled | 0.006142 | 0.000000 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B9 (2): the gateway process killed mid-stream, after output began: the hold is kept at its full amount, unreconciled, by the gateway started afterwards | project f14_311aa89a ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 5427 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5428 hold.found_at_startup | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B9 (3): the gateway process killed while it waits to write the settle (a third session holds the project's lock): nothing is written for the call, and the hold is kept, unreconciled, by the gateway started afterwards | project f14_1ed8f0bc ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 5429 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5430 hold.found_at_startup | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (1): the database refuses the call's model.call write after the provider answered: the hold stays open, unreconciled; the project is frozen, the fault raised; its next call and its counting call are refused with the reason, nothing forwarded, also after a cap raise; another project is unaffected | project f14_391e0c8f ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.029900 | 0.000000 |
| after event 5431 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5433 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5434 gateway.fault | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5435 project.frozen | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5436 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5437 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5438 cap.changed | 0.000000 | 0.009960 | 0.000000 | 10.000000 | 0.006142 |
| after event 5439 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 10.000000 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (1): the database refuses the call's model.call write after the provider answered: the hold stays open, unreconciled; the project is frozen, the fault raised; its next call and its counting call are refused with the reason, nothing forwarded, also after a cap raise; another project is unaffected | project f14_a1d0c0b0 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 5440 hold.opened | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 5441 model.call | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 5442 hold.settled | 0.006142 | 0.000000 | 0.000000 | 5.000000 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (2): the freeze itself cannot be written either: the gateway's gate stays closed and it forwards nothing for any project, writing nothing, until the freeze is written; then the project is frozen and the other resumes | project f14_74e3ea87 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.029900 | 0.000000 |
| after event 5443 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5445 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5446 gateway.fault | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5447 project.frozen | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5451 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (2): the freeze itself cannot be written either: the gateway's gate stays closed and it forwards nothing for any project, writing nothing, until the freeze is written; then the project is frozen and the other resumes | project f14_24690154 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 5448 hold.opened | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 5449 model.call | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 5450 hold.settled | 0.006142 | 0.000000 | 0.000000 | 5.000000 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (3): every write refused, then the gateway process killed: the journal line survives, and the gateway started afterwards writes it before it serves, so the project's first call is refused as frozen | project f14_cebb656a ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.029900 | 0.000000 |
| after event 5454 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5456 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5457 gateway.fault | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5458 project.frozen | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5459 hold.found_at_startup | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5460 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (3): every write refused, then the gateway process killed: the journal line survives, and the gateway started afterwards writes it before it serves, so the project's first call is refused as frozen | project f14_24d5e416 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 5461 hold.opened | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 5462 model.call | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 5463 hold.settled | 0.006142 | 0.000000 | 0.000000 | 5.000000 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (7): the journal file cannot be written either: the gate stays closed, with the record kept in memory, until the database takes it | project f14_94cc8fa4 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.029900 | 0.000000 |
| after event 5464 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5466 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5467 gateway.fault | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5468 project.frozen | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| after event 5472 gateway.refused | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.029900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (7): the journal file cannot be written either: the gate stays closed, with the record kept in memory, until the database takes it | project f14_60a726bf ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 5469 hold.opened | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 5470 model.call | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |
| after event 5471 hold.settled | 0.006142 | 0.000000 | 0.000000 | 5.000000 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 5.000000 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B10 (4): under the project's lock, a frozen project opens no hold, starts no step, and a running step's calls are refused, whatever the cap | project f14_87bdf1f8 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 5.000000 | 0.000000 |
| after event 5473 step.hold_opened | 0.000000 | 0.000000 | 0.019920 | 5.000000 | 0.000000 |
| after event 5474 hold.opened | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 5475 hold.kept | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 5476 gateway.fault | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 5477 project.frozen | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 5478 gateway.refused | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 5479 gateway.refused | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |
| after event 5480 step.refused | 0.000000 | 0.009960 | 0.019920 | 5.000000 | 0.000000 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B11 (1): a stream cut after output began keeps its full hold, open and unreconciled; the usage seen is recorded for information only, and nothing is released | project f14_e99562d4 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 5492 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5493 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B11 (2): a call that gets no answer at all (the provider read it and closed the connection) keeps its full hold, open and unreconciled | project f14_f0141b90 ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 5494 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5495 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B12: a successful answer that cannot be read (no usage block; a body that is not JSON) keeps its full hold, open, and the call marked unreconciled | project f14_8e4ba2dd ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 5496 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5497 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

== package 1.4: failure tests, proof rows B8 to B13 (against a stand-in provider) > B12: a successful answer that cannot be read (no usage block; a body that is not JSON) keeps its full hold, open, and the call marked unreconciled | project f14_6809ef3c ==
| state | spent | open holds | step room | cap | owed to the provider |
| --- | --- | --- | --- | --- | --- |
| before the first event | 0.000000 | 0.000000 | 0.000000 | 0.014900 | 0.000000 |
| after event 5498 hold.opened | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| after event 5499 hold.kept | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |
| billing point 1 (the budget view, read by the stand-in) | 0.000000 | 0.009960 | 0.000000 | 0.014900 | 0.006142 |

